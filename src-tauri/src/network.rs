use anyhow::{bail, Context, Result};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::{net::IpAddr, sync::LazyLock};

#[cfg(test)]
#[path = "tests/network.rs"]
mod tests;

fn short(value: &Value, limit: usize) -> Option<&str> {
    value.as_str().filter(|v| !v.is_empty() && v.len() <= limit)
}

fn error(message: &str) -> Value {
    json!({ "status": "error", "error": crate::i18n::text(message) })
}

fn read_ip(value: &Value, family: Option<u8>) -> Option<Value> {
    if value["status"] == "error" {
        return crate::i18n::valid(&value["error"])
            .then(|| json!({ "status": "error", "error": value["error"] }));
    }
    if value["status"] != "ok" {
        return None;
    }
    let address: IpAddr = value["ip"].as_str()?.parse().ok()?;
    if family == Some(4) && !address.is_ipv4() || family == Some(6) && !address.is_ipv6() {
        return None;
    }
    Some(json!({ "status": "ok", "ip": address.to_string() }))
}

fn subnet(value: &Value) -> Option<String> {
    let (network, bits) = short(value, 60)?.split_once('/')?;
    let network: IpAddr = network.parse().ok()?;
    let bits: u8 = bits.parse().ok()?;
    (bits > 0 && bits <= if network.is_ipv4() { 32 } else { 128 })
        .then(|| format!("{network}/{bits}"))
}

fn dns(value: &Value) -> Value {
    if value["status"] == "error" {
        if crate::i18n::valid(&value["error"]) {
            return json!({ "status": "error", "error": value["error"] });
        }
    }
    let invalid = || error("messages.invalidDnsResponseFormat");
    let Some(rows) = value["observations"]
        .as_array()
        .filter(|rows| rows.len() <= 128 && value["status"] == "ok")
    else {
        return invalid();
    };
    let observations: Vec<_> = rows.iter().filter_map(|row| {
        let address: IpAddr = row["resolver"].as_str()?.parse().ok()?;
        let mut result = json!({ "resolver": address.to_string(), "name": short(&row["name"], 253)?, "type": short(&row["type"], 24)? });
        if let Some(transport) = short(&row["transport"], 16) { result["transport"] = json!(transport); }
        if let Some(subnet) = subnet(&row["subnet"]) { result["subnet"] = json!(subnet); }
        Some(result)
    }).collect();
    if observations.is_empty() {
        return invalid();
    }
    json!({ "status": "ok", "partial": value["partial"] == true || observations.len() != rows.len(), "observations": observations })
}

fn webrtc(value: &Value) -> Option<Value> {
    static LOCAL: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)^[a-z0-9_.-]+\.local\.?$").unwrap());
    if !matches!(
        value["status"].as_str(),
        Some("complete" | "timeout" | "unsupported" | "error")
    ) || (!value["error"].is_null() && !crate::i18n::valid(&value["error"]))
    {
        return None;
    }
    let candidates = value["candidates"].as_array().filter(|v| v.len() <= 32)?;
    let candidates = candidates
        .iter()
        .map(|item| {
            if !matches!(
                item["type"].as_str(),
                Some("host" | "srflx" | "prflx" | "relay")
            ) || !matches!(item["protocol"].as_str(), Some("udp" | "tcp"))
            {
                return None;
            }
            let address = short(&item["address"], 253)?;
            let address = match address.parse::<IpAddr>() {
                Ok(ip) => ip.to_string(),
                Err(_) if LOCAL.is_match(address) => address.to_owned(),
                Err(_) => return None,
            };
            let mut row = item.clone();
            row["address"] = json!(address);
            Some(row)
        })
        .collect::<Option<Vec<_>>>()?;
    let mut report = value.clone();
    report["provider"] = json!("stuntman");
    report["candidates"] = json!(candidates);
    Some(report)
}

pub fn parse(value: &Value, tools: &[&str]) -> Value {
    let invalid = || error("messages.invalidNetworkResultFormat");
    let mut report = json!({});
    if tools.contains(&"ipify") {
        report["https"] = read_ip(&value["https"], None).unwrap_or_else(invalid);
        for (key, family) in [("ipv4", 4), ("ipv6", 6)] {
            if !value[key].is_null() {
                report[key] = read_ip(&value[key], Some(family)).unwrap_or_else(invalid);
            }
        }
    }
    if tools.contains(&"dns") {
        report["dns"] = if value["dns"].is_null() {
            invalid()
        } else {
            dns(&value["dns"])
        };
    }
    if tools.contains(&"webrtc") {
        report["webrtc"] = webrtc(&value["webrtc"]).unwrap_or_else(|| {
            let mut result = invalid();
            result["provider"] = json!("stuntman");
            result["candidates"] = json!([]);
            result
        });
    }
    if let Some(items) = value["addressMetadata"].as_object() {
        let mut metadata = Map::new();
        for (key, item) in items.iter().take(32) {
            let Ok(address) = key.parse::<IpAddr>() else {
                continue;
            };
            let mut row = Map::new();
            for (key, limit) in [
                ("organization", 240),
                ("city", 100),
                ("region", 100),
                ("country", 100),
                ("ptr", 253),
                ("ns", 253),
            ] {
                if let Some(value) = short(&item[key], limit) {
                    row.insert(key.to_owned(), json!(value));
                }
            }
            if let Some(asn) = item["asn"]
                .as_u64()
                .filter(|asn| *asn > 0 && *asn <= u32::MAX.into())
            {
                row.insert("asn".into(), json!(asn));
            }
            if !row.is_empty() {
                metadata.insert(address.to_string(), json!(row));
            }
        }
        report["addressMetadata"] = json!(metadata);
    }
    report
}

pub fn transport(text: &str) -> Result<Value> {
    let data: Value = serde_json::from_str(text).context("messages.invalidTrackmeResponseFormat")?;
    let Some(protocol) = short(&data["http_version"], 32) else {
        bail!("messages.invalidTrackmeResponseFormat");
    };
    let mut result = json!({ "status": "ok", "protocol": protocol });
    let tls = &data["tls"];
    let mut values = Map::new();
    if let Some(version) = short(&tls["tls_version_negotiated"], 32) {
        let version = match version {
            "769" => "TLS 1.0",
            "770" => "TLS 1.1",
            "771" => "TLS 1.2",
            "772" => "TLS 1.3",
            value => value,
        };
        values.insert("version".into(), json!(version));
    }
    for (key, field, length) in [("ja3", "ja3_hash", 64), ("ja4", "ja4", 80)] {
        if let Some(value) = short(&tls[field], length) {
            values.insert(key.into(), json!(value));
        }
    }
    if !values.is_empty() {
        result["tls"] = json!(values);
    }
    let http2 = &data["http2"];
    let settings: Vec<_> = http2["sent_frames"]
        .as_array()
        .into_iter()
        .flatten()
        .take(32)
        .filter(|frame| frame["frame_type"] == "SETTINGS")
        .flat_map(|frame| frame["settings"].as_array().into_iter().flatten().take(32))
        .filter_map(|setting| short(setting, 120))
        .collect();
    let fingerprint = short(&http2["akamai_fingerprint"], 512);
    if fingerprint.is_some() || !settings.is_empty() {
        result["http2"] = json!({ "settings": settings });
        if let Some(fingerprint) = fingerprint {
            result["http2"]["fingerprint"] = json!(fingerprint);
        }
    }
    Ok(result)
}
