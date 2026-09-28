
#[cfg(test)]
mod slice2_proof {
    use super::*;
    use serial_test::serial;
    use std::path::Path;

    fn official() -> Provider {
        let mut p = Provider::with_id("official-proof".into(), "Official".into(), serde_json::json!({"auth": {}, "config": ""}), None);
        p.category = Some("official".into());
        p
    }
    fn settings(unify: bool) {
        let mut s = crate::settings::get_settings();
        s.unify_codex_session_history = unify;
        crate::settings::update_settings(s).unwrap();
    }
    fn planned(unify: bool, url: &str, prepared: &Prepared) -> Planned {
        settings(unify);
        plan(&Database::memory().unwrap(), &Owner::None, &Target::Proxy { route: &official(), base_url: url }, prepared).unwrap()
    }
    fn render(p: &Planned, text: &str) -> toml_edit::DocumentMut {
        let mut doc = text.parse().unwrap();
        p.config.apply_to(Path::new("proof.toml"), &mut doc).unwrap();
        doc
    }
    #[test] #[serial]
    fn proof_shared_bucket_requirement() {
        let p = planned(true, "http://127.0.0.1:15721/v1", &Prepared::default());
        let doc = render(&p, "");
        assert_eq!(doc["model_provider"].as_str(), Some("custom"));
        assert_eq!(doc["model_providers"]["custom"]["requires_openai_auth"].as_bool(), Some(true));
    }
    #[test] #[serial]
    fn proof_reuse_custom_covers_empty_inline_and_preservation() {
        let mut p = planned(false, "http://127.0.0.1:15721/v1", &Prepared::default());
        p.config.route = RouteWrite::Custom(official_mirror_table(Some("http://127.0.0.1:15721/v1"), false));
        assert!(p.stamp.is_none());
        assert!(matches!(p.auth, AuthGoal::Official(_)));
        for text in ["", "model_providers = {}\n", "# user\n[model_providers.mine]\nbase_url = 'https://mine.example/v1' # retain\n[projects.'D:/work']\ntrust_level = 'trusted'\n"] {
            let doc = render(&p, text);
            assert_eq!(doc["model_provider"].as_str(), Some("custom"));
            let t = &doc["model_providers"]["custom"];
            assert_eq!(t["name"].as_str(), Some("OpenAI"));
            assert_eq!(t["requires_openai_auth"].as_bool(), Some(true));
            assert_eq!(t["supports_websockets"].as_bool(), Some(false));
            assert!(t.get("experimental_bearer_token").is_none());
            if text.contains("# retain") { assert!(doc.to_string().contains("base_url = 'https://mine.example/v1' # retain")); }
        }
    }
    #[test] #[serial]
    fn proof_contract_changes_selector_endpoint_and_account_not_token() {
        let p = planned(false, "http://127.0.0.1:15721/v1", &Prepared::default());
        let mut config = p.config.clone();
        config.route = RouteWrite::Custom(official_mirror_table(Some("http://127.0.0.1:15721/v1"), false));
        let row = official();
        let target = Target::Proxy { route: &row, base_url: "http://127.0.0.1:15721/v1" };
        let key = |prep: &Prepared| contract_of(&target, &config, None, prep, None).key;
        let a = Prepared { target_login: Some(("a".into(), serde_json::json!({"proof": "token-a"}))), outgoing: None };
        let refreshed = Prepared { target_login: Some(("a".into(), serde_json::json!({"proof": "token-b"}))), outgoing: None };
        let b = Prepared { target_login: Some(("b".into(), serde_json::json!({"proof": "token-b"}))), outgoing: None };
        assert_ne!(p.contract.key, key(&Prepared::default()));
        assert_eq!(key(&a), key(&refreshed));
        assert_ne!(key(&a), key(&b));
        assert_ne!(key(&a), contract_of(&Target::Proxy { route: &row, base_url: "http://[::1]:15722/v1" }, &config, None, &a, None).key);
        let managed = planned(true, "http://127.0.0.1:15721/v1", &a);
        assert!(matches!(managed.auth, AuthGoal::Managed(_)));
        assert!(managed.stamp.is_none());
    }
    #[test] #[serial]
    fn proof_profile_refusal_and_legacy_cleanup_are_preserved() {
        let mut p = planned(false, "http://127.0.0.1:15721/v1", &Prepared::default());
        p.config.route = RouteWrite::Custom(official_mirror_table(Some("http://127.0.0.1:15721/v1"), false));
        let mut doc = "profile = 'mine'\n[profiles.mine]\nmodel_provider = 'cc-switch-official'\n".parse().unwrap();
        assert!(p.config.apply_to(Path::new("proof.toml"), &mut doc).is_err());
        let doc = render(&p, "[model_providers.cc-switch-official]\nname = 'OpenAI'\n");
        assert!(doc["model_providers"].get("cc-switch-official").is_none());
        let doc = render(&p, "[profiles.mine]\nmodel_provider = 'cc-switch-official'\n[model_providers.cc-switch-official]\nname = 'OpenAI'\n");
        assert!(doc["model_providers"].get("cc-switch-official").is_some());
    }
}
