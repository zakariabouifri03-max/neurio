// Tiny BMP (32-bit, bottom-up) writer - diagnostics & self-test screenshots.
#pragma once
#include "common.h"

// rgba: 0xAABBGGRR
int WriteBmp_(const wchar_t* path, int w, int h, const unsigned int* rgba);
