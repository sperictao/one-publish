use std::collections::BTreeMap;

use publish_domain::{
    AdapterBinding, AdapterIdentity, AdapterKind, AdapterSchema, AdapterSettings, CredentialKind,
    CredentialValue, ResolvedCredential,
};

const SECRET: &str = "super-secret-material";

#[test]
fn credential_values_never_reveal_their_material_through_debug() {
    let value = CredentialValue::new(SECRET);
    let resolved = ResolvedCredential {
        kind: CredentialKind::SigningKey,
        value: value.clone(),
    };

    assert_eq!(value.expose(), SECRET);
    assert!(!format!("{value:?}").contains(SECRET));
    assert!(!format!("{resolved:?}").contains(SECRET));
}

#[test]
fn schema_credential_requirements_serialize_purpose_without_any_secret_channel() {
    let schema = AdapterSchema::new(1).with_credential(
        "signing-key",
        CredentialKind::SigningKey,
        "signs desktop installers",
    );

    let serialized = serde_json::to_string(&schema).expect("serialize schema");
    assert!(serialized.contains("signing-key"));
    assert!(serialized.contains("signs desktop installers"));
    assert!(serialized.contains("signing_key"));

    let roundtripped: AdapterSchema =
        serde_json::from_str(&serialized).expect("deserialize schema");
    assert_eq!(roundtripped, schema);
}

#[test]
fn adapter_bindings_carry_only_non_secret_credential_references() {
    let binding = AdapterBinding::new(
        "destination",
        AdapterIdentity::new(AdapterKind::DeliveryDestination, "github-release", 1),
        AdapterSettings::new(1),
    )
    .with_credential("release-token", "keychain://one-publish/release-token");

    assert_eq!(
        binding.credentials,
        BTreeMap::from([(
            "release-token".to_string(),
            "keychain://one-publish/release-token".to_string()
        )])
    );

    let serialized = serde_json::to_string(&binding).expect("serialize binding");
    assert!(serialized.contains("keychain://one-publish/release-token"));

    let roundtripped: AdapterBinding =
        serde_json::from_str(&serialized).expect("deserialize binding");
    assert_eq!(roundtripped, binding);
}
