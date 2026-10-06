#include "bmp.h"

int WriteBmp_(const wchar_t* path, int w, int h, const unsigned int* rgba){
    if (w <= 0 || h <= 0 || !rgba) return 0;
    int rowsize = w * 4;
    int size = 14 + 40 + rowsize * h;
    unsigned char hdr[54];
    memset(hdr, 0, sizeof hdr);
    hdr[0] = 'B'; hdr[1] = 'M';
    *(unsigned int*)(hdr + 2) = (unsigned int)size;
    *(unsigned int*)(hdr + 10) = 54;
    *(unsigned int*)(hdr + 14) = 40;          // BITMAPINFOHEADER
    *(int*)(hdr + 18) = w;
    *(int*)(hdr + 22) = h;
    *(unsigned short*)(hdr + 26) = 1;
    *(unsigned short*)(hdr + 28) = 32;
    *(unsigned int*)(hdr + 30) = (unsigned int)(rowsize * h);
    HANDLE f = CreateFileW(path, GENERIC_WRITE, 0, 0, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, 0);
    if (f == INVALID_HANDLE_VALUE) return 0;
    int ok = 1;
    DWORD wr;
    if (!WriteFile(f, hdr, sizeof hdr, &wr, 0) || (int)wr != (int)sizeof hdr) ok = 0;
    for (int y = h - 1; ok && y >= 0; y--){
        const unsigned char* row = (const unsigned char*)(rgba + (size_t)y * w);
        if (!WriteFile(f, row, (DWORD)rowsize, &wr, 0) || (int)wr != rowsize) ok = 0;
    }
    CloseHandle(f);
    return ok;
}
