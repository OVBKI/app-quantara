//! Enveloppe native.
//!
//! Elle ne contient aucune logique financière : tout le calcul vit dans l'interface,
//! en TypeScript, testé séparément. Le rôle de cette couche se limite à ouvrir une
//! fenêtre et à donner accès au disque pour la sauvegarde du profil.
//!
//! Le greffon « dialog » a été retiré : aucun appel ne l'utilisait — la sélection de
//! fichier passe par un `<input type="file">` de la page. Il ouvrait pourtant un
//! sélecteur natif, dont le chemin retourné élargit la portée du greffon de fichiers au
//! reste du disque. Une capacité accordée et jamais appelée est une porte laissée
//! ouverte sur une pièce où personne ne va.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .run(tauri::generate_context!())
        .expect("Quantara n'a pas pu démarrer");
}
