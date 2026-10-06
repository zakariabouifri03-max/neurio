// NovaForge Engine - editor/main_editor.cpp
// Editor entry point. Built as NovaForge.exe (GUI subsystem). A console entry point
// is provided as well so the same sources can be built as a console app for debugging.
#include "editor/EditorApp.h"
#include "core/FileSystem.h"
#include "core/Log.h"
#include "core/Time.h"

#include <string>
#include <vector>

#if NF_PLATFORM_WINDOWS
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#endif

namespace {

using namespace nf;

struct LaunchOptions {
  std::string projectPath;
  bool createProject = false;
  bool verbose = false;
  bool showHelp = false;
};

LaunchOptions ParseArguments(const std::vector<std::string>& arguments) {
  LaunchOptions options;
  for (usize i = 0; i < arguments.size(); i++) {
    const std::string& argument = arguments[i];
    if (argument == "--project" && i + 1 < arguments.size()) {
      options.projectPath = arguments[++i];
    } else if (argument == "--new-project" && i + 1 < arguments.size()) {
      options.projectPath = arguments[++i];
      options.createProject = true;
    } else if (argument == "--verbose" || argument == "-v") {
      options.verbose = true;
    } else if (argument == "--help" || argument == "-h" || argument == "/?") {
      options.showHelp = true;
    } else if (!argument.empty() && argument[0] != '-' && options.projectPath.empty()) {
      options.projectPath = argument;   // drag & drop a project folder onto the exe
    }
  }
  return options;
}

int RunEditor(const std::vector<std::string>& arguments) {
  using namespace nf;
  LaunchOptions options = ParseArguments(arguments);

  if (options.showHelp) {
    const char* help =
        "NovaForge Engine editor\n"
        "Usage: NovaForge.exe [--project <folder>] [--new-project <folder>] [--verbose]\n";
#if NF_PLATFORM_WINDOWS
    MessageBoxA(nullptr, help, "NovaForge", MB_OK | MB_ICONINFORMATION);
#else
    fprintf(stdout, "%s", help);
#endif
    return 0;
  }

  // logs live next to the executable until a project is opened (then inside the project)
  std::string logDirectory = fs::Join(fs::ExecutableDirectory().empty() ? fs::CurrentWorkingDirectory()
                                                                       : fs::ExecutableDirectory(),
                                      "Logs");
  fs::CreateDirectories(logDirectory);
  Log::Get().OpenFile(fs::Join(logDirectory, "NovaForge-Editor.log"));
  Log::Get().SetMinLevel(options.verbose ? LogLevel::Debug : LogLevel::Info);
  Log::Get().Write(LogLevel::Info, LogCategory::Editor, "NovaForge editor starting (%s)",
                   TimestampString().c_str());

  EditorApp app;
  if (!app.Initialize(options.createProject ? "" : options.projectPath)) {
    Log::Get().Write(LogLevel::Error, LogCategory::Editor, "Editor initialisation failed");
    return 1;
  }
  if (options.createProject && !options.projectPath.empty()) {
    app.CreateProject(fs::Parent(fs::Normalize(options.projectPath)),
                      fs::FileName(fs::Normalize(options.projectPath)));
  }
  int result = app.Run();
  Log::Get().Write(LogLevel::Info, LogCategory::Editor, "Editor closed (%d)", result);
  Log::Get().CloseFile();
  return result;
}

} // namespace

#if NF_PLATFORM_WINDOWS
int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR commandLine, int) {
  std::vector<std::string> arguments;
  if (commandLine && *commandLine) arguments.push_back(commandLine);
  // WinMain receives the raw command line: split it into arguments
  std::string raw = commandLine ? commandLine : "";
  arguments.clear();
  std::string current;
  bool quoted = false;
  for (char character : raw) {
    if (character == '"') {
      quoted = !quoted;
      continue;
    }
    if (character == ' ' && !quoted) {
      if (!current.empty()) arguments.push_back(current);
      current.clear();
      continue;
    }
    current.push_back(character);
  }
  if (!current.empty()) arguments.push_back(current);
  return RunEditor(arguments);
}
#endif

int main(int argc, char** argv) {
  std::vector<std::string> arguments;
  for (int i = 1; i < argc; i++) arguments.push_back(argv[i]);
  return RunEditor(arguments);
}
