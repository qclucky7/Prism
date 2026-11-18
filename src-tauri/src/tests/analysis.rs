use super::*;

#[test]
fn context_mismatches_exclude_unsupported_readings() {
    let result = findings(&json!({"main.platform":{"status":"ok","value":"Win32"}, "worker.platform":{"status":"ok","value":"MacIntel"}, "main.deviceMemory":{"status":"ok","value":8}, "worker.deviceMemory":{"status":"unsupported"}}));
    let warnings: Vec<_> = result.iter().filter(|v| v["severity"] == "warning").collect();
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0]["fields"], json!(["main.platform", "worker.platform"]));
}

#[test]
fn render_duplicates_require_distinct_instances_and_same_collector() {
    let a = json!({"id":"1","instanceId":"a","collectorVersion":"v1","signals":{"canvas.hash":{"status":"ok","value":"same"},"audio.hash":{"status":"unsupported"}}});
    let mut b = a.clone(); b["id"] = json!("2");
    assert!(duplicate_groups(&[a.clone(), b.clone()]).is_empty());
    b["instanceId"] = json!("b");
    let groups = duplicate_groups(&[a.clone(), b.clone()]);
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0]["field"], "canvas.hash");
    b["collectorVersion"] = json!("v2");
    assert!(duplicate_groups(&[a, b]).is_empty());
}

#[test]
fn upstream_evidence_retains_detail_and_weak_hints_stay_informational() {
    let result = findings(&json!({"creepjs.lies.data":{"status":"ok","value":{"Navigator.platform":["failed toString"]}},"creepjs.headless.likeHeadless.noTaskbar":{"status":"ok","value":true},"creepjs.headless.headless.hasHeadlessUA":{"status":"ok","value":true}}));
    assert!(result.iter().any(|v| crate::i18n::translate("en", &v["detail"]).contains("failed toString")));
    let weak: Vec<_> = result.iter().filter(|v| v["fields"].as_array().unwrap().contains(&json!("creepjs.headless.likeHeadless.noTaskbar"))).collect();
    assert_eq!(weak.len(), 1);
    assert_eq!(weak[0]["severity"], "info");
}
