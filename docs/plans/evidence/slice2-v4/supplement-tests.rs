
    #[tokio::test] #[serial]
    async fn proof_v4_generated_shapes_import_and_copy_are_explicit() {
        use crate::live::project::codex::official_mirror_table;
        for url in ["http://127.0.0.1:15721/v1", "http://[::1]:23456/v1", "http://192.168.1.23:23456/v1", "http://remote.example/v1"] {
            for inline in [false, true] {
                let _home = ProofHome::new();
                let s = AppState::new(Arc::new(Database::memory().unwrap()));
                let table = official_mirror_table(Some(url), false);
                let mut providers = toml_edit::Table::new();
                providers.insert("custom", if inline {
                    toml_edit::Item::Value(toml_edit::Value::InlineTable(table.into_inline_table()))
                } else { toml_edit::Item::Table(table) });
                let mut doc = toml_edit::DocumentMut::new();
                doc.insert("model_provider", toml_edit::value("custom"));
                doc.insert("model_providers", toml_edit::Item::Table(providers));
                let text = doc.to_string();
                seed_codex(&text, Some(&json!({})));
                let error = ProviderService::import_default_config(&s, AppType::Codex).unwrap_err();
                match error {
                    AppError::Localized { key, zh, en } => {
                        assert_eq!(key, "provider.import.live_taken_over");
                        assert!(zh.contains("或与代理投影形态相同"));
                        assert!(en.contains("or matches a proxy projection"));
                    }, other => panic!("unexpected error: {other}")
                }
                assert_eq!(codex_text(), text);
                assert!(s.db.get_all_providers("codex").unwrap().is_empty());
            }
        }
    }
    #[tokio::test] #[serial]
    async fn proof_v4_disabling_unify_restores_complete_dormant_table() {
        let _home = ProofHome::new();
        let row = codex_official();
        let s = state_with(AppType::Codex, &[row.clone()], &row.id).await;
        let prepared = codex_direct::Prepared::default();
        proof_toggle(true);
        let target = codex_direct::Target::Proxy { route: &row, base_url: "http://127.0.0.1:23456/v1" };
        let before = codex_direct::plan(&s.db, &Owner::None, &target, &prepared).unwrap();
        let path = codex_config_path();
        let mut doc = toml_edit::DocumentMut::new();
        before.config().apply_to(&path, &mut doc).unwrap();
        proof_toggle(false);
        let after = codex_direct::plan(&s.db, &Owner::None, &target, &prepared).unwrap();
        after.config().apply_to(&path, &mut doc).unwrap();
        assert_eq!(doc["model_provider"].as_str(), Some("cc-switch-official"));
        let t = doc["model_providers"]["custom"].as_table().unwrap();
        assert_eq!(t.len(), 4);
        assert_eq!(t["name"].as_str(), Some("custom"));
        assert_eq!(t["base_url"].as_str(), Some("http://127.0.0.1:23456/v1"));
        assert_eq!(t["wire_api"].as_str(), Some("responses"));
        assert_eq!(t["experimental_bearer_token"].as_str(), Some(PROXY_TOKEN_PLACEHOLDER));
        assert!(!t.contains_key("requires_openai_auth"));
        assert!(!t.contains_key("supports_websockets"));
    }
    #[tokio::test] #[serial]
    async fn proof_v4_real_address_change_rewrites_endpoint_and_preserves_auth() {
        let _home = ProofHome::new();
        let row = codex_official();
        let s = state_with(AppType::Codex, &[row.clone()], &row.id).await;
        proof_toggle(true);
        seed_codex("", Some(&json!({})));
        enter(&s, &AppType::Codex).await.unwrap();
        let before = codex_text();
        let auth_before = fs::read(codex_auth_path()).unwrap();
        let key_before = mode(&AppType::Codex).contract.unwrap().key;
        let mut config = s.proxy_service.get_config().await.unwrap();
        // Real service restart, port 0 requests a fresh isolated listener; all-interface bind is
        // not needed. Loopback address change alone makes the emitted endpoint observably different.
        config.listen_address = "127.0.0.2".into();
        config.listen_port = 0;
        assert!(s.proxy_service.update_config(&config).await.unwrap());
        resync_route(&s, &AppType::Codex).await.unwrap();
        let after = codex_text();
        let expected = s.proxy_service.build_proxy_urls().await.unwrap().1;
        let key_after = mode(&AppType::Codex).contract.unwrap().key;
        let auth_after = fs::read(codex_auth_path()).unwrap();
        exit(&s, &AppType::Codex).await.unwrap();
        assert_ne!(before, after);
        assert_ne!(key_before, key_after);
        let doc: toml::Table = toml::from_str(&after).unwrap();
        assert_eq!(doc["model_providers"]["custom"]["base_url"].as_str(), Some(expected.as_str()));
        assert_eq!(auth_before, auth_after);
    }
    #[tokio::test] #[serial]
    async fn proof_v4_unified_proxy_official_third_party_roundtrip() {
        let _home = ProofHome::new();
        let official = codex_official();
        let relay = codex_row("proof-relay", "https://relay.example/v1", "");
        let s = state_with(AppType::Codex, &[official.clone(), relay.clone()], &official.id).await;
        proof_toggle(true);
        let auth = json!({"auth_mode":"chatgpt", "tokens":{"id_token":"proof-id", "access_token":"proof-access", "refresh_token":"proof-refresh", "account_id":"proof-account"}});
        seed_codex("", Some(&auth));
        enter(&s, &AppType::Codex).await.unwrap();
        ProviderService::switch(&s, AppType::Codex, &relay.id).unwrap();
        let relay_text = codex_text();
        let relay_auth: Value = serde_json::from_slice(&fs::read(codex_auth_path()).unwrap()).unwrap();
        ProviderService::switch(&s, AppType::Codex, &official.id).unwrap();
        let official_text = codex_text();
        let official_auth: Value = serde_json::from_slice(&fs::read(codex_auth_path()).unwrap()).unwrap();
        exit(&s, &AppType::Codex).await.unwrap();
        let r: toml::Table = toml::from_str(&relay_text).unwrap();
        let o: toml::Table = toml::from_str(&official_text).unwrap();
        assert_eq!(r["model_provider"].as_str(), Some("custom"));
        assert_eq!(r["model_providers"]["custom"]["experimental_bearer_token"].as_str(), Some(PROXY_TOKEN_PLACEHOLDER));
        assert_eq!(o["model_provider"].as_str(), Some("custom"));
        assert_eq!(o["model_providers"]["custom"]["requires_openai_auth"].as_bool(), Some(true));
        assert!(o["model_providers"]["custom"].get("experimental_bearer_token").is_none());
        assert_eq!(relay_auth, auth);
        assert_eq!(official_auth, auth);
        assert_eq!(s.db.get_provider_by_id(&relay.id,"codex").unwrap().unwrap().settings_config, relay.settings_config);
        assert_eq!(s.db.get_provider_by_id(&official.id,"codex").unwrap().unwrap().settings_config, official.settings_config);
    }
    #[tokio::test] #[serial]
    async fn proof_v4_safe_snippet_fields_remain_in_extractor_but_startup_skips() {
        let _home = ProofHome::new();
        let s = AppState::new(Arc::new(Database::memory().unwrap()));
        let text = format!("sandbox_mode = 'read-only'\n{}", proof_mirror());
        let extracted = ProviderService::extract_common_config_snippet_from_settings(AppType::Codex, &json!({"config":text})).unwrap();
        let d: toml::Table = toml::from_str(&extracted).unwrap();
        assert_eq!(d["sandbox_mode"].as_str(), Some("read-only"));
        seed_codex(&text,Some(&json!({})));
        crate::initialize_common_config_snippets(&s);
        assert!(s.db.get_config_snippet("codex").unwrap().is_none());
    }
    #[tokio::test] #[serial]
    async fn proof_v4_actual_save_rollback_then_full_mode_startup() {
        use tauri::Manager;
        let _home = ProofHome::new();
        let row = codex_official();
        let s = state_with(AppType::Codex, &[row.clone()], &row.id).await;
        proof_toggle(false);
        seed_codex("", Some(&json!({})));
        enter(&s, &AppType::Codex).await.unwrap();
        let app = tauri::test::mock_builder().manage(s)
            .build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
        let mut requested = crate::settings::get_settings();
        requested.unify_codex_session_history = true;
        requested.unify_codex_migrate_existing = Some(false);
        failpoint::crash_at(Some("published:0"));
        let result = crate::commands::save_settings(app.state(), requested).await;
        failpoint::crash_at(None);
        assert!(result.is_err());
        eprintln!("actual save result: {result:?}");
        assert!(!crate::settings::unify_codex_session_history());
        assert!(operation::has_pending("codex"));
        let d: toml::Table = toml::from_str(&codex_text()).unwrap();
        assert_eq!(d["model_provider"].as_str(),Some("custom"));
        // Saving the already-rolled-back value does not re-enter the changed-toggle branch.
        crate::commands::save_settings(app.state(),crate::settings::get_settings()).await.unwrap();
        assert!(operation::has_pending("codex"));
        let s = app.state::<AppState>();
        operation::settle(&s.db,"codex").unwrap();
        assert!(!operation::has_pending("codex"));
        let still_new: toml::Table = toml::from_str(&codex_text()).unwrap();
        assert_eq!(still_new["model_provider"].as_str(),Some("custom"));
        // Exercise the actual startup sequence, including forced attach, not just settle.
        startup(s.inner()).await;
        let repaired: toml::Table = toml::from_str(&codex_text()).unwrap();
        exit(s.inner(),&AppType::Codex).await.unwrap();
        assert_eq!(repaired["model_provider"].as_str(),Some("cc-switch-official"));
        assert!(!crate::settings::unify_codex_session_history());
    }
