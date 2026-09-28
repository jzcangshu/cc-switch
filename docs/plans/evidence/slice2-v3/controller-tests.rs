
    struct ProofHome { previous: Option<OsString> }
    impl ProofHome {
        fn new() -> Self {
            let base = std::env::var_os("SLICE2_PROOF_ROOT").expect("isolated proof root");
            let path = std::path::PathBuf::from(base).join(uuid::Uuid::new_v4().to_string());
            fs::create_dir_all(&path).unwrap();
            let previous = std::env::var_os("CC_SWITCH_TEST_HOME");
            std::env::set_var("CC_SWITCH_TEST_HOME", path);
            crate::settings::reload_settings().unwrap();
            Self { previous }
        }
    }
    impl Drop for ProofHome {
        fn drop(&mut self) {
            failpoint::crash_at(None);
            if let Some(v) = &self.previous { std::env::set_var("CC_SWITCH_TEST_HOME", v); }
            else { std::env::remove_var("CC_SWITCH_TEST_HOME"); }
            crate::settings::reload_settings().unwrap();
        }
    }
    fn proof_mirror() -> &'static str {
        "model_provider = 'custom'\n[model_providers.custom]\nname = 'OpenAI'\nrequires_openai_auth = true\nsupports_websockets = false\nwire_api = 'responses'\nbase_url = 'http://127.0.0.1:15721/v1'\n"
    }
    fn proof_toggle(value: bool) {
        let mut s = crate::settings::get_settings(); s.unify_codex_session_history = value;
        crate::settings::update_settings(s).unwrap();
    }
    #[tokio::test] #[serial]
    async fn proof_manual_shape_does_not_authorize_startup_write() {
        let _home = ProofHome::new();
        let row = codex_official();
        let s = state_with(AppType::Codex, &[row.clone()], &row.id).await;
        commit_state(&s, &AppType::Codex, &PendingTarget::mode(ModeState { mode: Some(Mode::Direct), ..Default::default() })).unwrap();
        seed_codex(proof_mirror(), Some(&json!({})));
        startup_app(&s, &AppType::Codex).await.unwrap();
        assert_eq!(codex_text(), proof_mirror());
    }
    #[test] #[serial]
    fn proof_manual_row_is_not_polluted() {
        let mut row = codex_official();
        row.settings_config["config"] = json!(proof_mirror());
        assert!(usable_direct(&AppType::Codex, Some(&row)).is_some());
    }
    #[tokio::test] #[serial]
    async fn proof_import_guard_requirement_without_mode_state() {
        let _home = ProofHome::new();
        let s = AppState::new(Arc::new(Database::memory().unwrap()));
        seed_codex(proof_mirror(), Some(&json!({})));
        let result = crate::services::provider::live::import_default_config(&s, AppType::Codex);
        assert!(result.is_err(), "a proxy-shaped live config was imported: {result:?}");
        assert!(s.db.get_provider_by_id("default", "codex").unwrap().is_none());
    }
    #[tokio::test] #[serial]
    async fn proof_import_baseline_does_not_have_keyless_fallback() {
        let _home = ProofHome::new();
        let s = AppState::new(Arc::new(Database::memory().unwrap()));
        seed_codex(proof_mirror(), Some(&json!({})));
        // Baseline-only characterization; candidate intentionally rejects this import.
        if std::env::var("SLICE2_STAGE").as_deref() == Ok("baseline") {
            assert_eq!(crate::services::provider::live::import_default_config(&s, AppType::Codex).unwrap(), true);
            assert!(s.db.get_provider_by_id("default", "codex").unwrap().is_some());
        }
    }
    #[tokio::test] #[serial]
    async fn proof_real_resync_keeps_native_auth_and_switches_bucket() {
        let _home = ProofHome::new();
        let row = codex_official();
        let s = state_with(AppType::Codex, &[row.clone()], &row.id).await;
        let auth = json!({"auth_mode":"chatgpt", "tokens":{"id_token":"proof-id", "access_token":"proof-access", "refresh_token":"proof-refresh", "account_id":"proof-account"}});
        seed_codex("model = 'gpt-5.4'\n", Some(&auth));
        proof_toggle(false);
        enter(&s, &AppType::Codex).await.unwrap();
        let old_key = mode(&AppType::Codex).contract.unwrap().key;
        proof_toggle(true);
        crate::services::provider::reapply_current_codex_official_live(&s).unwrap();
        let text = codex_text();
        let d: toml::Table = toml::from_str(&text).unwrap();
        let bucket = d["model_provider"].as_str().unwrap().to_string();
        let new_key = mode(&AppType::Codex).contract.unwrap().key;
        let auth_after: Value = serde_json::from_slice(&fs::read(codex_auth_path()).unwrap()).unwrap();
        let marked = format!("# external comment proves unchanged contract skips writes\n{text}");
        fs::write(codex_config_path(), &marked).unwrap();
        failpoint::crash_at(Some("staged"));
        let no_write = resync_route(&s, &AppType::Codex).await;
        failpoint::crash_at(None);
        no_write.unwrap();
        let unchanged = codex_text() == marked;
        proof_toggle(false);
        crate::services::provider::reapply_current_codex_official_live(&s).unwrap();
        let back: toml::Table = toml::from_str(&codex_text()).unwrap();
        // Release the real local listener before assertions can panic.
        exit(&s, &AppType::Codex).await.unwrap();
        assert_eq!(bucket, "custom");
        assert_ne!(old_key, new_key);
        assert_eq!(auth_after, auth);
        assert!(unchanged);
        assert_eq!(back["model_provider"].as_str(), Some("cc-switch-official"));
    }
    #[tokio::test] #[serial]
    async fn proof_new_pending_recovers_without_shape_detection() {
        let _home = ProofHome::new();
        let row = codex_official();
        let s = state_with(AppType::Codex, &[row.clone()], &row.id).await;
        proof_toggle(true);
        seed_codex("", Some(&json!({})));
        let target = codex_direct::Target::Proxy { route: &row, base_url: "http://127.0.0.1:15721/v1" };
        let prepared = codex_direct::Prepared::default();
        let p = codex_direct::plan(&s.db, &Owner::None, &target, &prepared).unwrap();
        let pending = PendingTarget::mode(ModeState { mode: Some(Mode::Proxy), attached: true, proxy_route: Some(row.id.clone()), contract: Some(p.contract.clone()) });
        failpoint::crash_at(Some("published:0"));
        assert!(codex_direct::run(&s.db, "proof", p, &prepared, pending).is_err());
        failpoint::crash_at(None);
        assert!(operation::has_pending("codex"));
        operation::settle(&s.db, "codex").unwrap();
        assert!(!operation::has_pending("codex"));
        assert!(mode(&AppType::Codex).attached);
        assert_eq!(mode(&AppType::Codex).proxy_route.as_deref(), Some(row.id.as_str()));
    }

    #[tokio::test] #[serial]
    async fn proof_import_shape_matrix_and_native_control() {
        for url in ["http://127.0.0.1:15721/v1", "http://[::1]:23456/v1", "http://192.168.1.23:23456/v1"] {
            let _home = ProofHome::new();
            let s = AppState::new(Arc::new(Database::memory().unwrap()));
            let text = proof_mirror().replace("http://127.0.0.1:15721/v1", url);
            seed_codex(&text, Some(&json!({})));
            assert!(ProviderService::import_default_config(&s, AppType::Codex).is_err(), "{url}");
        }
        let _home = ProofHome::new();
        let s = AppState::new(Arc::new(Database::memory().unwrap()));
        let native = proof_mirror().replace("supports_websockets = false", "supports_websockets = true").replace("base_url = 'http://127.0.0.1:15721/v1'\n", "");
        seed_codex(&native, Some(&json!({})));
        assert!(ProviderService::import_default_config(&s, AppType::Codex).unwrap());
    }
    #[tokio::test] #[serial]
    async fn proof_snippet_guard_and_extractor_are_distinct() {
        let _home = ProofHome::new();
        let s = AppState::new(Arc::new(Database::memory().unwrap()));
        let text = format!("sandbox_mode = 'read-only'\n{}", proof_mirror());
        seed_codex(&text, Some(&json!({})));
        let extracted = ProviderService::extract_common_config_snippet_from_settings(AppType::Codex, &json!({"config":text})).unwrap();
        assert!(!extracted.contains("model_providers"));
        assert!(!extracted.contains("127.0.0.1"));
        crate::initialize_common_config_snippets(&s);
        assert!(s.db.get_config_snippet("codex").unwrap().is_none());
    }
    #[tokio::test] #[serial]
    async fn proof_managed_account_auth_and_marker_survive_projection_change() {
        let _home = ProofHome::new();
        let mut row = codex_official();
        row.meta = Some(crate::provider::ProviderMeta {
            auth_binding: Some(crate::provider::AuthBinding {
                source: crate::provider::AuthBindingSource::ManagedAccount,
                auth_provider: Some("codex_oauth".into()), account_id: Some("proof-managed".into()),
            }), ..Default::default()
        });
        let s = state_with(AppType::Codex, &[row.clone()], &row.id).await;
        s.codex_oauth_manager.add_test_account_with_user_identity("proof-managed", "synthetic-access", "synthetic-user").await.unwrap();
        seed_codex("", Some(&json!({})));
        proof_toggle(false);
        enter(&s, &AppType::Codex).await.unwrap();
        let before_auth = fs::read(codex_auth_path()).unwrap();
        let marker = crate::codex_config::get_codex_managed_oauth_live_auth_marker_path();
        let before_marker = fs::read(&marker).unwrap();
        proof_toggle(true);
        crate::services::provider::reapply_current_codex_official_live(&s).unwrap();
        let after_auth = fs::read(codex_auth_path()).unwrap();
        let after_marker = fs::read(&marker).unwrap();
        let doc: toml::Table = toml::from_str(&codex_text()).unwrap();
        exit(&s, &AppType::Codex).await.unwrap();
        assert_eq!(doc["model_provider"].as_str(), Some("custom"));
        assert_eq!(before_auth, after_auth);
        assert_eq!(before_marker, after_marker);
    }
