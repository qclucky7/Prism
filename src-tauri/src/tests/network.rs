use super::*;

#[test]
fn structured_probe_failures_are_preserved_and_invalid_ips_rejected() {
    let failure = crate::i18n::message("messages.ipifyReturnedHttp", json!([429]));
    let report = parse(&json!({"ipv4":{"status":"error","error":failure}}), &["ipify"]);
    assert_eq!(report["ipv4"], json!({"status":"error","error":failure}));
    let report = parse(&json!({"ipv4":{"status":"ok","ip":"not-an-ip"}}), &["ipify"]);
    assert_ne!(report["ipv4"]["status"], "ok");
    assert!(!crate::i18n::valid(&json!({"code":"messages.ipifyReturnedHttp","params":[{"unsupported":true}]})));
    assert!(!crate::i18n::valid(&json!({"code":"errors.missingKey","params":[]})));
}

#[tokio::test]
async fn api_errors_arrive_localized_with_stable_codes_and_params() {
    let descriptor = crate::i18n::message("messages.ipifyReturnedHttp", json!([403]));
    let english = crate::i18n::LANGUAGE.scope("en", async { crate::i18n::response_error(descriptor.clone()) }).await;
    let chinese = crate::i18n::LANGUAGE.scope("zh-CN", async { crate::i18n::response_error(descriptor) }).await;
    assert_eq!(english["code"], chinese["code"]); assert_eq!(english["params"], json!([403]));
    assert_eq!(english["message"], "ipify returned HTTP 403");
    assert_eq!(chinese["message"], "ipify 返回 HTTP 403");
}
