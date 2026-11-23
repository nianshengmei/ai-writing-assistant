use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// 数据根目录标记文件（存于应用配置目录）
fn data_root_marker(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let cfg = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("获取配置目录失败: {e}"))?;
    fs::create_dir_all(&cfg).map_err(|e| e.to_string())?;
    Ok(cfg.join("data-root.txt"))
}

fn default_data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败: {e}"))?;
    Ok(dir.join("AI写作助手"))
}

#[tauri::command]
fn get_data_root(app: tauri::AppHandle) -> Result<String, String> {
    let marker = data_root_marker(&app)?;
    if let Ok(p) = fs::read_to_string(&marker) {
        let p = p.trim().to_string();
        if !p.is_empty() {
            return Ok(p);
        }
    }
    let default = default_data_root(&app)?;
    Ok(default.to_string_lossy().to_string())
}

#[tauri::command]
fn set_data_root(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let marker = data_root_marker(&app)?;
    fs::write(&marker, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn pick_data_root(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(picked.map(|f| f.to_string()))
}

#[tauri::command]
fn pick_save_path(app: tauri::AppHandle, default_name: String) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .blocking_pick_file();
    Ok(picked.map(|f| f.to_string()))
}

/// 防目录穿越：拒绝包含 ".." 的相对路径
fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.replace('\\', "/");
    let rel = rel.trim_start_matches('/');
    if rel.split('/').any(|seg| seg == ".." || seg.is_empty() && false) || rel.split('/').any(|seg| seg == "..") {
        return Err(format!("非法路径: {rel}"));
    }
    Ok(Path::new(root).join(rel))
}

#[tauri::command]
fn read_text(root: String, rel: String) -> Result<String, String> {
    let p = resolve(&root, &rel)?;
    fs::read_to_string(p).map_err(|e| format!("读取失败: {e}"))
}

#[tauri::command]
fn write_text_atomic(root: String, rel: String, content: String) -> Result<(), String> {
    let p = resolve(&root, &rel)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = p.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("写入失败: {e}"))?;
        f.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        f.sync_all().ok();
    }
    fs::rename(&tmp, &p).map_err(|e| format!("原子替换失败: {e}"))
}

#[tauri::command]
fn delete_path(root: String, rel: String) -> Result<(), String> {
    let p = resolve(&root, &rel)?;
    if !p.exists() {
        return Ok(());
    }
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[derive(serde::Serialize)]
pub struct DirEntryInfo {
    pub name: String,
    #[serde(rename = "isDir")]
    pub is_dir: bool,
}

#[tauri::command]
fn list_dir(root: String, rel: String) -> Result<Vec<DirEntryInfo>, String> {
    let p = resolve(&root, &rel)?;
    if !p.exists() {
        return Ok(vec![]);
    }
    let mut out: Vec<DirEntryInfo> = Vec::new();
    for entry in fs::read_dir(&p).map_err(|e| format!("读取目录失败: {e}"))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = entry.path().is_dir();
        out.push(DirEntryInfo { name, is_dir });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

#[tauri::command]
fn exists(root: String, rel: String) -> Result<bool, String> {
    Ok(resolve(&root, &rel)?.exists())
}

/// 导出：写到用户通过保存对话框选择的任意绝对路径
#[tauri::command]
fn export_text(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_data_root,
            set_data_root,
            pick_data_root,
            pick_save_path,
            read_text,
            write_text_atomic,
            delete_path,
            list_dir,
            exists,
            export_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
