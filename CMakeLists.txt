cmake_minimum_required(VERSION 3.16)
project(PianoPro VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT WIN32)
    message(WARNING "Piano Pro is a Windows desktop application. Cross-compile with a MinGW or Zig Windows toolchain.")
endif()

add_executable(PianoPro WIN32
    Source/Main.cpp
    Source/App.cpp
    Source/PianoEngine.cpp
    Source/PianoKeyboard.cpp
    Source/AudioEngine.cpp
    Source/MidiManager.cpp
    Source/RecordingManager.cpp
    Source/SettingsManager.cpp
    Source/Synth.cpp
)

target_include_directories(PianoPro PRIVATE Source)

if(WIN32)
    if(EXISTS "${CMAKE_SOURCE_DIR}/Source/PianoPro.rc")
        target_sources(PianoPro PRIVATE Source/PianoPro.rc)
    endif()
    target_compile_definitions(PianoPro PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
    target_link_libraries(PianoPro PRIVATE
        user32 gdi32 winmm ole32 uuid comdlg32 comctl32
        shell32 shlwapi dwmapi advapi32 oleaut32
    )
    if(MSVC)
        target_compile_options(PianoPro PRIVATE /W3 /utf-8 /MP)
        target_link_options(PianoPro PRIVATE /SUBSYSTEM:WINDOWS)
    else()
        target_compile_options(PianoPro PRIVATE -O2 -ffast-math)
        target_link_options(PianoPro PRIVATE -static -municode)
    endif()
endif()

add_executable(PianoPro_Setup WIN32 installer/Setup.cpp)
if(WIN32)
    target_compile_definitions(PianoPro_Setup PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
    target_link_libraries(PianoPro_Setup PRIVATE
        user32 gdi32 ole32 uuid shell32 shlwapi advapi32 comctl32 oleaut32
    )
    if(MSVC)
        target_link_options(PianoPro_Setup PRIVATE /SUBSYSTEM:WINDOWS)
    else()
        target_link_options(PianoPro_Setup PRIVATE -static)
    endif()
endif()

install(TARGETS PianoPro PianoPro_Setup RUNTIME DESTINATION .)
install(DIRECTORY assets DESTINATION . OPTIONAL)
