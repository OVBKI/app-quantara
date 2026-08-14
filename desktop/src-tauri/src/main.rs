// Sans cet attribut, une fenêtre de console noire s'ouvre derrière l'application
// sous Windows. En débogage on la garde : c'est là que sortent les traces.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    quantara_lib::run()
}
