import os
import shutil

# Configuration
SCRIPT_NAME = "AnitaDarin"
IGNORED_DIRS = [".git", "__pycache__", "venv"]


def get_paths():
    # 1. Automatically determine the project root directory
    # Using the directory where build.py is located
    builder_dir = os.path.dirname(os.path.abspath(__file__))

    # Assume source files are in 'src', otherwise fallback to root
    src_dir = os.path.join(builder_dir, "src")

    if not os.path.exists(src_dir):
        src_dir = builder_dir
        print("[Build] 'src' directory not found, using root directory as source.")

    # 2. Path to Stand Lua Scripts folder
    appdata = os.getenv("APPDATA")
    if not appdata:
        print("[Build] ERROR: APPDATA environment variable not found. This script is intended for Windows.")
        return None, None
    stand_lua_dir = os.path.join(appdata, "Stand", "Lua Scripts")

    return src_dir, stand_lua_dir


def find_existing_items(src_dir, stand_lua_dir):
    # Only check the script-specific subfolder inside shared dirs (lib, resources, store)
    target_script_check = os.path.join(stand_lua_dir, f"{SCRIPT_NAME}.pluto")
    existing_items = []

    if os.path.exists(target_script_check):
        existing_items.append((f"{SCRIPT_NAME}.pluto", target_script_check, "file"))

    for item in os.listdir(src_dir):
        source = os.path.join(src_dir, item)
        if os.path.isdir(source) and item not in IGNORED_DIRS:
            script_subdir = os.path.join(stand_lua_dir, item, SCRIPT_NAME)
            if os.path.exists(script_subdir):
                existing_items.append((f"{item}/{SCRIPT_NAME}/", script_subdir, "dir"))

    return existing_items


def clean(src_dir, stand_lua_dir):
    existing_items = find_existing_items(src_dir, stand_lua_dir)

    if not existing_items:
        print(f'\nNo "{SCRIPT_NAME}" script files found in Stand, nothing to clean.')
        return

    print(f'\nFound "{SCRIPT_NAME}" script files in Stand:')
    for name, _, _ in existing_items:
        print(f"  - {name}")

    for name, path, kind in existing_items:
        if kind == "file" and os.path.exists(path):
            os.remove(path)
            print(f"🗑️  Deleted file {name}")
        elif kind == "dir" and os.path.exists(path):
            shutil.rmtree(path)
            print(f"🗑️  Deleted folder '{name}'")


def sync(src_dir, stand_lua_dir):
    print(f"\n--- Synchronizing project from: {src_dir} ---")

    # Synchronize the main script file
    source_script = os.path.join(src_dir, f"{SCRIPT_NAME}.pluto")
    target_script = os.path.join(stand_lua_dir, f"{SCRIPT_NAME}.pluto")

    if os.path.exists(source_script):
        shutil.copy(source_script, target_script)
        print(f"📄 File {SCRIPT_NAME}.pluto updated.")
    else:
        print(f"⚠️ File {SCRIPT_NAME}.pluto not found in {src_dir}!")

    # Automatically synchronize all folders, ignoring system files
    for item in os.listdir(src_dir):
        source = os.path.join(src_dir, item)

        # Copy directories only, ignore project metadata and build artifacts
        if os.path.isdir(source) and item not in IGNORED_DIRS:
            target = os.path.join(stand_lua_dir, item)
            shutil.copytree(source, target, dirs_exist_ok=True)
            print(f"📂 Folder '{item}' synchronized.")

    print(f"\n🎉 All {SCRIPT_NAME} files have been updated in Stand!")


def show_status(src_dir, stand_lua_dir):
    existing_items = find_existing_items(src_dir, stand_lua_dir)

    print(f"\nSource: {src_dir}")
    print(f"Stand:  {stand_lua_dir}")
    if existing_items:
        print(f'Installed "{SCRIPT_NAME}" files:')
        for name, _, _ in existing_items:
            print(f"  - {name}")
    else:
        print(f'"{SCRIPT_NAME}" script is not installed in Stand.')


def main():
    src_dir, stand_lua_dir = get_paths()
    if not stand_lua_dir:
        return

    actions = {
        "1": ("Update files (overwrite)", lambda: sync(src_dir, stand_lua_dir)),
        "2": ("Clean and update", lambda: (clean(src_dir, stand_lua_dir), sync(src_dir, stand_lua_dir))),
        "3": ("Clean only", lambda: clean(src_dir, stand_lua_dir)),
        "4": ("Show status", lambda: show_status(src_dir, stand_lua_dir)),
    }

    while True:
        print(f"\n===== {SCRIPT_NAME} Build =====")
        for key, (title, _) in actions.items():
            print(f"  {key}. {title}")
        print("  0. Exit")

        choice = input("Select an option: ").strip()

        if choice == "0":
            break
        if choice in actions:
            actions[choice][1]()
        else:
            print("Invalid option, please try again.")


if __name__ == "__main__":
    main()
