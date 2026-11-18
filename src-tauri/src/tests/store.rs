use super::*;

#[test]
fn profile_restart_port_reuse_history_pagination_and_deletion() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let db = Store::open(directory.path())?;
    let base = json!({"id":"first","endpoint":"http://127.0.0.1:9222","name":"Profile A","vendor":"inferred","vendorSource":"inferred","profile":directory.path().join("profiles/a"),"executable":directory.path().join("vendor/chrome.exe"),"pid":42});
    db.save_instance(base.clone())?;
    db.update_instance("first", "My profile", "My vendor")?;
    let mut manual = base.clone();
    for field in ["profile", "executable", "pid"] { manual.as_object_mut().unwrap().remove(field); }
    manual["id"] = json!("manual");
    let registered = db.save_instance(manual)?;
    assert_eq!(registered["pid"], 42);
    assert_eq!(registered["profile"], base["profile"]);
    assert_eq!(registered["vendor"], "My vendor");
    let mut restarted = base.clone();
    restarted["id"] = json!("restart"); restarted["endpoint"] = json!("http://127.0.0.1:9555"); restarted["pid"] = json!(100);
    let restarted = db.save_instance(restarted)?;
    assert_eq!(restarted["id"], "first"); assert_eq!(restarted["name"], "My profile");
    let mut different = base;
    different["id"] = json!("other-profile"); different["endpoint"] = restarted["endpoint"].clone();
    different["profile"] = json!(directory.path().join("profiles/b"));
    let different = db.save_instance(different)?;
    assert_eq!(different["id"], "other-profile"); assert_ne!(different["name"], "My profile");
    assert_eq!(db.instances()?.len(), 1);
    db.update_instance("other-profile", "Saved profile B", "Saved vendor B")?;
    let historical = json!({"id":"historical","instanceId":"other-profile","name":"Saved profile B","vendor":"Saved vendor B","endpoint":different["endpoint"],"collectedAt":"2026-11-11T00:00:00.000Z","batchId":"old-batch","batchStartedAt":"2026-11-11T00:00:00.000Z","signals":{},"findings":[],"engine":{"raw":{"evidence":"kept"}}});
    db.save_snapshot(&historical)?;
    assert!(db.sync_instances(vec![])?.is_empty());
    assert!(db.instances()?.is_empty()); assert_eq!(db.snapshots()?.len(), 1);
    let mut reappeared = different;
    reappeared["id"] = json!("new-scan"); reappeared["endpoint"] = json!("http://127.0.0.1:9666");
    let reappeared = db.sync_instances(vec![reappeared])?;
    assert_eq!(reappeared.len(), 1); assert_eq!(reappeared[0]["id"], "other-profile");
    assert_eq!(reappeared[0]["name"], "Saved profile B"); assert_eq!(reappeared[0]["vendor"], "Saved vendor B");
    for index in 0..301 {
        let mut recent = historical.clone();
        recent["id"] = json!(format!("new-{index}")); recent["name"] = json!("Recent probe"); recent["collectedAt"] = json!("2099-01-01T00:00:00.000Z");
        for field in ["batchId", "batchStartedAt"] { recent.as_object_mut().unwrap().remove(field); }
        db.save_snapshot(&recent)?;
    }
    assert_eq!(db.count()?, 302);
    assert!(!db.snapshots()?.iter().any(|v| v["id"] == "historical"));
    assert_eq!(db.snapshot_page(302, 1, "", None, None, "", false, "", "")?["rows"][0]["id"], "historical");
    let filtered = db.snapshot_page(5, 20, "saved profile", None, Some("2099-01-01T00:00:00.000Z".into()), "", false, "", "")?;
    assert_eq!(filtered["total"], 1); assert_eq!(filtered["page"], 1); assert_eq!(filtered["rows"][0]["id"], "historical");
    assert_eq!(db.snapshot("historical")?.unwrap()["engine"]["raw"]["evidence"], "kept");
    assert!(filtered["rows"][0]["engine"].get("raw").is_none());
    let batches = db.batches()?;
    assert_eq!(batches.len(), 1); assert_eq!(batches[0]["batchId"], "old-batch");
    assert_eq!(db.in_batch("old-batch")?[0]["id"], "historical");
    assert_eq!(db.delete(Some("old-batch"), &json!([]))?, vec!["historical"]);
    assert_eq!(db.count()?, 301);
    drop(db);
    let reopened = Store::open(directory.path())?;
    assert_eq!(reopened.instances()?[0]["vendor"], "Saved vendor B");
    assert_eq!(reopened.count()?, 301);
    Ok(())
}
