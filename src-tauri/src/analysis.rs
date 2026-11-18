use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

#[cfg(test)]
#[path = "tests/analysis.rs"]
mod tests;

pub fn findings(signals: &Value) -> Vec<Value> {
    let mut result = Vec::new();
    let Some(signals) = signals.as_object() else {
        return result;
    };
    for context in ["iframe", "worker"] {
        for field in [
            "userAgent",
            "platform",
            "language",
            "languages",
            "hardwareConcurrency",
            "deviceMemory",
            "timezone",
            "uaData",
        ] {
            let a = format!("main.{field}");
            let b = format!("{context}.{field}");
            if let Some((left, right)) = signals.get(&a).zip(signals.get(&b)) {
                if left["status"] == "ok"
                    && right["status"] == "ok"
                    && left["value"] != right["value"]
                {
                    result.push(json!({ "severity": "warning", "title": crate::i18n::message("messages.differsFromInTheMainPage", json!([context, field])),
                        "detail": "messages.contextsInTheSameInstanceReturnedDifferentValuesReview", "fields": [a,b] }));
                }
            }
        }
    }
    let source = "messages.reviewThisCreepjsHeuristicResultAlongsideProfileSettingsPrivacy";
    if let Some(lies) = signals
        .get("creepjs.lies.data")
        .filter(|v| v["status"] == "ok")
        .and_then(|v| v["value"].as_object())
    {
        for (api, checks) in lies {
            if let Some(checks) = checks.as_array().filter(|v| !v.is_empty()) {
                let detail = checks
                    .iter()
                    .map(|v| {
                        v.as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| v.to_string())
                    })
                    .collect::<Vec<_>>()
                    .join("; ");
                result.push(json!({ "severity": "warning", "title": crate::i18n::message("messages.creepjsCheckFailed", json!([api])),
                    "detail": crate::i18n::message("findings.detailWithSource", json!([detail, crate::i18n::text(source)])), "fields": ["creepjs.lies.data", "creepjs.lies.totalLies"] }));
            }
        }
    }
    let mut weak = Vec::new();
    let mut missing = Vec::new();
    for (key, signal) in signals {
        if signal["status"] != "ok" {
            missing.push(key);
            continue;
        }
        let truthy = match &signal["value"] {
            Value::Null => false,
            Value::Bool(value) => *value,
            Value::Number(value) => value.as_f64().is_some_and(|v| v != 0.0),
            Value::String(value) => !value.is_empty(),
            _ => true,
        };
        let parts: Vec<_> = key.split('.').collect();
        if let ["creepjs", module, "lied"] = parts.as_slice() {
            if truthy {
                result.push(json!({ "severity": "warning", "title": crate::i18n::message("messages.creepjsModuleReportedAnAnomaly", json!([module])),
                    "detail": source, "fields": [key, "creepjs.lies.data"] }));
            }
        }
        if signal["value"] == true {
            if let Some(name) = key.strip_prefix("creepjs.headless.") {
                if name.starts_with("headless.") || name.starts_with("stealth.") {
                    result.push(json!({ "severity": "warning", "title": crate::i18n::message("findings.creepjsIndicator", json!([name])), "detail": source, "fields": [key] }));
                } else if name.starts_with("likeHeadless.") {
                    weak.push(key);
                }
            }
        }
    }
    if !weak.is_empty() {
        result.push(json!({ "severity": "info", "title": crate::i18n::message("messages.creepjsWeakHeadlessIndicators", json!([weak.len()])),
            "detail": "messages.theseSignalsCanAlsoAppearInARegularBrowser", "fields": weak }));
    }
    if !missing.is_empty() {
        result.push(json!({ "severity": "info", "title": crate::i18n::message("messages.readingsWithoutValidValues", json!([missing.len()])),
            "detail": "messages.unavailableAndFailedReadingsAreExcludedFromFingerprintMatches", "fields": missing }));
    }
    result
}

pub fn duplicate_groups(snapshots: &[Value]) -> Vec<Value> {
    let mut result = Vec::new();
    for field in [
        "canvas.hash",
        "webgl.hash",
        "audio.hash",
        "creepjs.canvas2d.dataURIHash",
        "creepjs.webgl.pixelsHash",
        "creepjs.webgl.pixels2Hash",
        "creepjs.audio.sampleHash",
    ] {
        let mut groups: BTreeMap<String, Vec<&Value>> = BTreeMap::new();
        for snapshot in snapshots {
            let signal = &snapshot["signals"][field];
            if signal["status"] != "ok" || signal["value"].is_null() || signal["value"] == "" {
                continue;
            }
            let commit = signal["source"]["commit"]
                .as_str()
                .or_else(|| snapshot["collectorVersion"].as_str());
            let algorithm = signal["source"]["algorithm"].as_str().unwrap_or(field);
            let key = json!([commit, algorithm, signal["value"]]).to_string();
            groups.entry(key).or_default().push(snapshot);
        }
        for items in groups.into_values() {
            if items
                .iter()
                .map(|item| item["instanceId"].as_str())
                .collect::<HashSet<_>>()
                .len()
                > 1
            {
                result.push(json!({ "field": field, "value": items[0]["signals"][field]["value"],
                    "snapshotIds": items.iter().filter_map(|item| item["id"].as_str()).collect::<Vec<_>>() }));
            }
        }
    }
    result
}
