use anyhow::{bail, Context, Result};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, ToSql};
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
};

use crate::platform::profile_key;

#[cfg(test)]
#[path = "tests/store.rs"]
mod tests;

pub struct Store(Mutex<Connection>);

pub fn summary(mut value: Value) -> Value {
    if let Some(engine) = value.get_mut("engine").and_then(Value::as_object_mut) {
        engine.remove("raw");
    }
    value
}

fn strings(db: &Connection, sql: &str, args: impl rusqlite::Params) -> Result<Vec<String>> {
    Ok(db
        .prepare(sql)?
        .query_map(args, |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?)
}

fn values(db: &Connection, sql: &str, args: impl rusqlite::Params) -> Result<Vec<Value>> {
    strings(db, sql, args)?
        .iter()
        .map(|v| Ok(serde_json::from_str(v)?))
        .collect()
}

fn instances(db: &Connection, include_inactive: bool) -> Result<Vec<Value>> {
    values(
        db,
        if include_inactive {
            "SELECT payload FROM instances ORDER BY rowid"
        } else {
            "SELECT payload FROM instances WHERE active=1 ORDER BY rowid"
        },
        [],
    )
}

fn save_instance(db: &Connection, mut incoming: Value) -> Result<Value> {
    let known = instances(db, true)?;
    let owner = known
        .iter()
        .find(|value| value["endpoint"] == incoming["endpoint"]);
    let key = profile_key(&incoming);
    let same_profile = key.as_ref().and_then(|key| {
        known
            .iter()
            .find(|value| profile_key(value).as_ref() == Some(key))
    });
    let conflict = owner.is_some_and(|owner| {
        let other = profile_key(owner);
        let different = |field: &str| {
            owner[field]
                .as_str()
                .zip(incoming[field].as_str())
                .is_some_and(|(a, b)| a != b)
        };
        (key.is_some() && other.is_some() && key != other)
            || different("profile")
            || different("debuggerPath")
    });
    let previous = same_profile.or(owner.filter(|_| !conflict));
    if let Some(owner) = owner.filter(|owner| previous.is_none_or(|item| owner["id"] != item["id"]))
    {
        db.execute("DELETE FROM instances WHERE id=?", [owner["id"].as_str()])?;
    }
    if let Some(previous) = previous {
        let mut merged = previous.as_object().context("errors.invalidInstanceFormat")?.clone();
        merged.extend(incoming.as_object().context("errors.invalidInstanceFormat")?.clone());
        if incoming.get("appIcon").is_none()
            && previous["executable"]
                .as_str()
                .zip(incoming["executable"].as_str())
                .is_some_and(|(old, new)| {
                    crate::platform::normalized(old) != crate::platform::normalized(new)
                })
        {
            merged.remove("appIcon");
        }
        for field in ["id", "name", "vendorSource"] {
            merged.insert(field.into(), previous[field].clone());
        }
        if previous["vendorSource"] == "manual" {
            merged.insert("vendor".into(), previous["vendor"].clone());
        }
        incoming = Value::Object(merged);
    }
    db.execute(
        "INSERT INTO instances(id,endpoint,payload,active) VALUES(?,?,?,1)
        ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint,payload=excluded.payload,active=1",
        params![
            incoming["id"].as_str(),
            incoming["endpoint"].as_str(),
            incoming.to_string()
        ],
    )?;
    Ok(incoming)
}

impl Store {
    pub fn open(directory: &Path) -> Result<Self> {
        std::fs::create_dir_all(directory)?;
        let mut db = Connection::open(directory.join("prism.sqlite"))?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch("PRAGMA journal_mode=WAL;")?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        tx.execute_batch("CREATE TABLE IF NOT EXISTS instances (id TEXT PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
            CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, collected_at TEXT NOT NULL, payload TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS app_icons (executable TEXT PRIMARY KEY, png_base64 TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS snapshots_collected ON snapshots(collected_at DESC, id DESC);
            CREATE INDEX IF NOT EXISTS snapshots_batch ON snapshots(json_extract(payload, '$.batchId'), collected_at DESC, id DESC)
                WHERE json_extract(payload, '$.batchId') IS NOT NULL;")?;
        if !strings(&tx, "SELECT name FROM pragma_table_info('instances')", [])?
            .iter()
            .any(|v| v == "active")
        {
            tx.execute(
                "ALTER TABLE instances ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
                [],
            )?;
        }
        tx.commit()?;
        Ok(Self(Mutex::new(db)))
    }

    fn lock(&self) -> Result<MutexGuard<'_, Connection>> {
        self.0
            .lock()
            .map_err(|_| anyhow::anyhow!("errors.theCaptureDatabaseIsUnavailable"))
    }

    pub fn language(&self) -> Result<Option<String>> {
        self.preference("language")
    }

    pub fn theme(&self) -> Result<Option<String>> {
        self.preference("theme")
    }

    fn preference(&self, key: &str) -> Result<Option<String>> {
        Ok(self
            .lock()?
            .query_row("SELECT value FROM preferences WHERE key=?", [key], |row| {
                row.get(0)
            })
            .optional()?)
    }

    pub fn set_preferences(&self, language: Option<&str>, theme: Option<&str>) -> Result<()> {
        let mut db = self.lock()?;
        let tx = db.transaction()?;
        for (key, value) in [("language", language), ("theme", theme)] {
            if let Some(value) = value {
                tx.execute("INSERT INTO preferences(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn instances(&self) -> Result<Vec<Value>> {
        instances(&*self.lock()?, false)
    }

    pub fn app_icon(&self, executable: &str) -> Result<Option<String>> {
        Ok(self
            .lock()?
            .query_row(
                "SELECT png_base64 FROM app_icons WHERE executable=?",
                [executable],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn save_app_icon(&self, executable: &str, png_base64: &str) -> Result<String> {
        let db = self.lock()?;
        db.execute(
            "INSERT OR IGNORE INTO app_icons(executable,png_base64) VALUES(?,?)",
            params![executable, png_base64],
        )?;
        Ok(db.query_row(
            "SELECT png_base64 FROM app_icons WHERE executable=?",
            [executable],
            |row| row.get(0),
        )?)
    }

    pub fn sync_instances(&self, incoming: Vec<Value>) -> Result<Vec<Value>> {
        let mut db = self.lock()?;
        let tx = db.transaction()?;
        tx.execute("UPDATE instances SET active=0", [])?;
        for instance in incoming {
            save_instance(&tx, instance)?;
        }
        let result = instances(&tx, false)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn save_instance(&self, instance: Value) -> Result<Value> {
        let mut db = self.lock()?;
        let tx = db.transaction()?;
        let result = save_instance(&tx, instance)?;
        tx.commit()?;
        Ok(result)
    }

    pub fn update_instance(&self, id: &str, name: &str, vendor: &str) -> Result<Value> {
        let db = self.lock()?;
        let Some(mut instance) = instances(&db, false)?.into_iter().find(|v| v["id"] == id) else {
            bail!("messages.instanceNotFound");
        };
        instance["name"] = json!(name);
        instance["vendor"] = json!(vendor);
        instance["vendorSource"] = json!("manual");
        db.execute(
            "UPDATE instances SET payload=? WHERE id=?",
            params![instance.to_string(), id],
        )?;
        Ok(instance)
    }

    pub fn snapshots(&self) -> Result<Vec<Value>> {
        Ok(values(
            &*self.lock()?,
            "SELECT payload FROM snapshots ORDER BY collected_at DESC, id DESC LIMIT 300",
            [],
        )?
        .into_iter()
        .map(summary)
        .collect())
    }

    pub fn count(&self) -> Result<i64> {
        Ok(self
            .lock()?
            .query_row("SELECT COUNT(*) FROM snapshots", [], |row| row.get(0))?)
    }

    pub fn batches(&self) -> Result<Vec<Value>> {
        values(&*self.lock()?, "SELECT json_object('batchId', json_extract(payload, '$.batchId'),
            'batchStartedAt', MIN(json_extract(payload, '$.batchStartedAt')),
            'snapshots', json_group_array(json_object('id', id, 'collectedAt', collected_at,
                'instanceId', json_extract(payload, '$.instanceId'), 'name', json_extract(payload, '$.name'),
                'vendor', json_extract(payload, '$.vendor'), 'appIcon', json_extract(payload, '$.appIcon'),
                'captureTools', json_extract(payload, '$.captureTools'),
                'collectorVersion', json_extract(payload, '$.collectorVersion')) ORDER BY collected_at DESC, id DESC))
            FROM snapshots WHERE json_extract(payload, '$.batchId') IS NOT NULL
            GROUP BY json_extract(payload, '$.batchId')
            ORDER BY MIN(json_extract(payload, '$.batchStartedAt')) DESC, json_extract(payload, '$.batchId') DESC", [])
    }

    pub fn in_batch(&self, id: &str) -> Result<Vec<Value>> {
        Ok(values(&*self.lock()?, "SELECT payload FROM snapshots WHERE json_extract(payload, '$.batchId')=? ORDER BY collected_at DESC, id DESC", [id])?
            .into_iter().map(summary).collect())
    }

    pub fn latest(&self, instance: &str) -> Result<Option<Value>> {
        Ok(values(&*self.lock()?, "SELECT payload FROM snapshots WHERE json_extract(payload, '$.instanceId')=? ORDER BY collected_at DESC,id DESC LIMIT 1", [instance])?
            .pop().map(summary))
    }

    pub fn snapshot(&self, id: &str) -> Result<Option<Value>> {
        Ok(values(
            &*self.lock()?,
            "SELECT payload FROM snapshots WHERE id=?",
            [id],
        )?
        .pop())
    }

    pub fn snapshot_vendors(&self) -> Result<Vec<Value>> {
        values(&*self.lock()?, "WITH vendors AS (
            SELECT id, collected_at, json_extract(payload, '$.vendor') AS vendor,
                NULLIF(json_extract(payload, '$.appIcon'), '') AS icon
            FROM snapshots
        ), ranked AS (
            SELECT vendor, icon, ROW_NUMBER() OVER (
                PARTITION BY vendor ORDER BY icon IS NULL, collected_at DESC, id DESC
            ) AS position FROM vendors WHERE vendor IS NOT NULL AND vendor <> ''
        )
        SELECT json_object('vendor', vendor, 'appIcon', icon)
        FROM ranked WHERE position=1 ORDER BY vendor COLLATE NOCASE, vendor", [])
    }

    pub fn snapshot_page(
        &self,
        mut page: i64,
        size: i64,
        query: &str,
        from: Option<String>,
        until: Option<String>,
        batch: &str,
        group_by_batch: bool,
        provider: &str,
        vendor: &str,
    ) -> Result<Value> {
        let db = self.lock()?;
        let mut conditions = vec!["1=1"];
        let mut parameters: Vec<&dyn ToSql> = Vec::new();
        if !query.is_empty() {
            conditions.push("instr(lower(json_extract(payload, '$.name') || ' ' || json_extract(payload, '$.vendor')), lower(?)) > 0");
            parameters.push(&query);
        }
        if !vendor.is_empty() {
            conditions.push("json_extract(payload, '$.vendor') = ?");
            parameters.push(&vendor);
        }
        if let Some(ref from) = from {
            conditions.push("collected_at >= ?");
            parameters.push(from);
        }
        if let Some(ref until) = until {
            conditions.push("collected_at < ?");
            parameters.push(until);
        }
        match batch {
            "legacy" => conditions.push("json_extract(payload, '$.batchId') IS NULL"),
            "" => (),
            _ => {
                conditions.push("json_extract(payload, '$.batchId') = ?");
                parameters.push(&batch);
            }
        }
        // Keep historical CreepJS classification aligned with captureProviders in the UI.
        let browser_leaks_json;
        match provider {
            "browserleaks" => {
                browser_leaks_json = json!(crate::capture::MANIFEST.capture_tool_ids.iter()
                    .filter(|id| id.starts_with("bl-")).collect::<Vec<_>>()).to_string();
                conditions.push("EXISTS (SELECT 1 FROM json_each(payload, '$.captureTools') AS tool WHERE tool.value IN (SELECT value FROM json_each(?)))");
                parameters.push(&browser_leaks_json);
            }
            "creepjs" => {
                conditions.push("(EXISTS (SELECT 1 FROM json_each(payload, '$.captureTools') AS tool WHERE tool.value = 'creepjs')
                    OR (json_extract(payload, '$.captureTools') IS NULL AND json_extract(payload, '$.collectorVersion') GLOB 'prism-2:*'))");
            }
            "fingerprintjs" => {
                conditions.push("EXISTS (SELECT 1 FROM json_each(payload, '$.captureTools') AS tool WHERE tool.value = 'fingerprintjs')");
            }
            "" => (),
            _ => bail!("messages.selectValidCaptureTools"),
        }
        let filter = conditions.join(" AND ");
        // An unbatched record is its own group. Prefixes keep record and batch IDs distinct.
        let group_key = "COALESCE('batch:' || json_extract(payload, '$.batchId'), 'record:' || id)";
        let count = if group_by_batch {
            format!("COUNT(DISTINCT {group_key})")
        } else {
            "COUNT(*)".to_owned()
        };
        let total: i64 = db.query_row(
            &format!("SELECT {count} FROM snapshots WHERE {filter}"),
            params_from_iter(&parameters),
            |row| row.get(0),
        )?;
        page = page.min(((total + size - 1) / size).max(1));
        let offset = (page - 1) * size;
        parameters.extend([&size as &dyn ToSql, &offset]);
        let page_query = if group_by_batch {
            format!("WITH matched AS (
                SELECT id, collected_at, {group_key} AS group_key,
                    COALESCE(json_extract(payload, '$.batchStartedAt'), collected_at) AS started_at
                FROM snapshots WHERE {filter}
            ), groups AS (
                SELECT group_key, MIN(started_at) AS started_at
                FROM matched GROUP BY group_key
                ORDER BY started_at DESC, group_key DESC LIMIT ? OFFSET ?
            ), page AS (
                SELECT s.id, s.collected_at, s.payload, g.started_at AS sort_time, g.group_key AS sort_key
                FROM groups g JOIN matched m USING (group_key) JOIN snapshots s ON s.id=m.id
            )")
        } else {
            format!("WITH page AS (
                SELECT id,collected_at,payload,collected_at AS sort_time,id AS sort_key
                FROM snapshots WHERE {filter} ORDER BY collected_at DESC,id DESC LIMIT ? OFFSET ?
            )")
        };
        let rows = values(&db, &format!("{page_query}
            SELECT json_object('id', id, 'collectedAt', collected_at,
                'instanceId', json_extract(payload, '$.instanceId'), 'name', json_extract(payload, '$.name'),
                'vendor', json_extract(payload, '$.vendor'), 'batchId', json_extract(payload, '$.batchId'),
                'appIcon', json_extract(payload, '$.appIcon'),
                'batchStartedAt', json_extract(payload, '$.batchStartedAt'), 'captureTools', json_extract(payload, '$.captureTools'),
                'collectorVersion', json_extract(payload, '$.collectorVersion'),
                'changeBeforeId', json_extract(payload, '$.configurationChange.beforeId'),
                'fields', (SELECT COUNT(*) FROM json_each(payload, '$.signals')),
                'valid', (SELECT COUNT(*) FROM json_each(payload, '$.signals') WHERE json_extract(value, '$.status')='ok'),
                'warnings', (SELECT COUNT(*) FROM json_each(payload, '$.findings') WHERE json_extract(value, '$.severity')='warning'))
            FROM page ORDER BY sort_time DESC,sort_key DESC,collected_at DESC,id DESC"), params_from_iter(parameters))?;
        Ok(json!({ "rows": rows, "total": total, "page": page }))
    }

    pub fn delete(&self, batch: Option<&str>, ids: &Value) -> Result<Vec<String>> {
        let db = self.lock()?;
        if let Some(batch) = batch {
            strings(
                &db,
                "DELETE FROM snapshots WHERE json_extract(payload, '$.batchId')=? RETURNING id",
                [batch],
            )
        } else {
            strings(
                &db,
                "DELETE FROM snapshots WHERE id IN (SELECT value FROM json_each(?)) RETURNING id",
                [ids.to_string()],
            )
        }
    }

    pub fn save_dns(&self, id: &str, report: &Value) -> Result<()> {
        if self.lock()?.execute(
            "UPDATE snapshots SET payload=json_set(payload, '$.dnsSite', json(?)) WHERE id=?",
            params![report.to_string(), id],
        )? == 0
        {
            bail!("messages.snapshotNotFound");
        }
        Ok(())
    }

    pub fn save_snapshot(&self, snapshot: &Value) -> Result<()> {
        let mut db = self.lock()?;
        let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(before) = snapshot["configurationChange"]["beforeId"].as_str() {
            if !tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM snapshots WHERE id=?)",
                [before],
                |r| r.get::<_, bool>(0),
            )? {
                bail!("messages.theBeforeSnapshotWasDeleted");
            }
        }
        tx.execute(
            "INSERT INTO snapshots(id,collected_at,payload) VALUES(?,?,?)",
            params![
                snapshot["id"].as_str(),
                snapshot["collectedAt"].as_str(),
                snapshot.to_string()
            ],
        )?;
        tx.commit()?;
        Ok(())
    }
}
