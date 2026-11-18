use super::*;

#[test]
fn vendor_inference_distinguishes_executable_and_directory() {
    for executable in ["ClonBrowserCore.exe", r"D:\Apps\ClonBrowserCore.exe"] {
        assert_eq!(vendor(executable, None, None), "ClonBrowser");
    }
    assert_eq!(vendor(r"D:\ClonBrowserCore.exe\test.exe", None, None), "待标记厂商");
    assert_eq!(vendor(r"D:\Applications\SunBrowser.exe", None, None), "AdsPower");
    assert_eq!(vendor("chrome.exe", Some(r"D:\ClonBrowserData\profiles\sample"), None), "ClonBrowser");
    assert_eq!(vendor("chrome.exe", None, Some(r"D:\AdsPower\AdsPower.exe")), "AdsPower");
    assert_eq!(vendor("ClonBrowserCore.exe", None, Some("AdsPower.exe")), "ClonBrowser");
    assert_eq!(vendor(r"C:\Program Files\Google\Chrome\Application\chrome.exe", None, None), "Google Chrome");
    assert_eq!(vendor("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", None, None), "Google Chrome");
}

#[test]
fn switches_support_windows_quotes_and_unix_argument_vectors() {
    let process = Process { command_line: Some(r#""C:\Vendor Browser\chrome.exe" --user-data-dir="D:\profiles\profile one" --remote-debugging-port 4567"#.into()), ..Process::default() };
    assert_eq!(process.arg("user-data-dir").as_deref(), Some(r"D:\profiles\profile one"));
    assert_eq!(process.arg("remote-debugging-port").as_deref(), Some("4567"));
    let process = Process { args: vec!["--user-data-dir=/Users/test/Profile One".into(), "--remote-debugging-port".into(), "0".into()], ..Process::default() };
    assert_eq!(process.arg("user-data-dir").as_deref(), Some("/Users/test/Profile One"));
    assert_eq!(process.arg("remote-debugging-port").as_deref(), Some("0"));
}

#[test]
fn profile_identity_normalizes_paths_and_preserves_profile_directory() {
    let temp = tempfile::tempdir().unwrap();
    let base = json!({"executable":temp.path().join("vendor/browser.exe"), "profile":temp.path().join("profiles/random"), "profileDirectory":"Profile 1"});
    let key = profile_key(&base).unwrap();
    let mut other = base.clone();
    other["profile"] = json!(temp.path().join("profiles/unused/../random"));
    assert_eq!(profile_key(&other).as_deref(), Some(key.as_str()));
    other["profileDirectory"] = json!("Profile 2");
    assert_ne!(profile_key(&other).as_deref(), Some(key.as_str()));
    other.as_object_mut().unwrap().remove("profileDirectory");
    assert_ne!(profile_key(&other).as_deref(), Some(key.as_str()));
    other["profile"] = json!("relative-profile");
    assert!(profile_key(&other).is_none());
    #[cfg(windows)] {
        let a = json!({"executable":r"C:\Vendor\browser.exe", "profile":r"D:\Profiles\RandomId", "profileDirectory":"Profile 1"});
        let b = json!({"executable":"c:/vendor/browser.exe", "profile":"d:/profiles/randomid/", "profileDirectory":"PROFILE 1"});
        assert_eq!(profile_key(&a), profile_key(&b));
    }
}

#[test]
fn debug_endpoints_are_strictly_local_http_roots() {
    assert_eq!(cdp::local_endpoint("127.0.0.1:9222").unwrap().as_str(), "http://127.0.0.1:9222/");
    for address in ["http://example.com:9222", "http://127.0.0.1:9222/path", "http://user:pass@localhost:9222", "file:///tmp/foo", "http://localhost"] {
        assert!(cdp::local_endpoint(address).is_err(), "{address}");
    }
}
