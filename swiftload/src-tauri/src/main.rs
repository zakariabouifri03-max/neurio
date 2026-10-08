// Release builds must not open a console window behind the application window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    swiftload_lib::run()
}
