//! Enveloppe native.
//!
//! Elle ne contient aucune logique financière : tout le calcul vit dans l'interface,
//! en TypeScript, testé séparément. Le rôle de cette couche se limite à ouvrir une
//! fenêtre et à donner accès au disque pour la sauvegarde du profil.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("Quantara n'a pas pu démarrer");
}
