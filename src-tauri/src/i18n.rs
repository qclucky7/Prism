use anyhow::Error;
use serde_json::{json, Value};
use std::{fmt, sync::LazyLock};

static MESSAGES: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../shared/i18n/en.json"))
        .expect("validated localization resources")
});
static CHINESE: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../shared/i18n/zh-CN.json"))
        .expect("validated localization resources")
});

tokio::task_local! {
    pub static LANGUAGE: &'static str;
}

pub fn translate(locale: &str, value: &Value) -> String {
    let code = value
        .as_str()
        .or_else(|| value["code"].as_str())
        .unwrap_or_default();
    let dictionary = if locale == "en" {
        &*MESSAGES
    } else {
        &*CHINESE
    };
    let template = dictionary[code].as_str().unwrap_or(code);
    static PLACEHOLDER: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"\{(\d+)\}").unwrap());
    PLACEHOLDER
        .replace_all(template, |captures: &regex::Captures<'_>| {
            let index: usize = captures[1].parse().unwrap();
            match &value["params"][index] {
                Value::Null => String::new(),
                Value::String(text) => text.clone(),
                param if param.is_object() => translate(locale, param),
                param => param.to_string(),
            }
        })
        .into_owned()
}

pub fn response_error(value: Value) -> Value {
    let mut descriptor = if value.is_object() {
        value
    } else if value
        .as_str()
        .is_some_and(|code| MESSAGES.get(code).is_some())
    {
        text(value.as_str().unwrap())
    } else {
        message("errors.operationFailed", json!([value]))
    };
    let locale = LANGUAGE.try_with(|locale| *locale).unwrap_or("zh-CN");
    descriptor["message"] = json!(translate(locale, &descriptor));
    descriptor
}

#[derive(Debug)]
pub struct MessageError(pub Value);

impl fmt::Display for MessageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let code = self
            .0
            .as_str()
            .or_else(|| self.0["code"].as_str())
            .unwrap_or("unknown");
        write!(formatter, "{code}")
    }
}

impl std::error::Error for MessageError {}

pub fn message(code: &str, params: Value) -> Value {
    assert!(
        MESSAGES.get(code).is_some(),
        "unknown localization key {code}"
    );
    json!({ "code": code, "params": params })
}

pub fn text(value: &str) -> Value {
    if MESSAGES.get(value).is_some() {
        message(value, json!([]))
    } else {
        json!(value)
    }
}

pub fn error_value(error: &Error) -> Value {
    if let Some(message) = error.downcast_ref::<MessageError>() {
        return message.0.clone();
    }
    text(&error.to_string())
}

pub fn valid(value: &Value) -> bool {
    fn check(value: &Value, depth: usize) -> bool {
        if let Some(text) = value.as_str() {
            return text.len() <= 2400;
        }
        if depth >= 4 {
            return false;
        }
        value["code"]
            .as_str()
            .is_some_and(|code| MESSAGES.get(code).is_some())
            && value["params"].as_array().is_some_and(|params| {
                params.len() <= 20
                    && params.iter().all(|param| {
                        param.is_null()
                            || param.is_boolean()
                            || param.is_number()
                            || check(param, depth + 1)
                    })
            })
    }
    check(value, 0)
}
