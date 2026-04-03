fn main() {
    let output_path = one_publish_lib::contracts::generated_contract_path();
    one_publish_lib::contracts::write_generated_tauri_contracts(&output_path).unwrap_or_else(
        |error| {
            panic!(
                "写入 Tauri 共享合同失败 ({}): {}",
                output_path.display(),
                error
            );
        },
    );

    println!("generated {}", output_path.display());
}
