// Minimal JSON parser / writer (flat tree, char[256] strings).
// Used for game profiles. Not a general-purpose library.
#pragma once
#include "common.h"

JVal* JVNew(JKind k, const char* key);
JVal* JVObjPutNum(JVal* o, const char* k, double v);
JVal* JVObjPutStr(JVal* o, const char* k, const char* v);
JVal* JVObjPutInt(JVal* o, const char* k, int v);
JVal* JVObjPutBool(JVal* o, const char* k, int v);
JVal* JVFind(JVal* o, const char* k);
double JVNum(JVal* o, const char* k, double dflt);
int JVInt(JVal* o, const char* k, int dflt);
const char* JVStr(JVal* o, const char* k, const char* dflt);
JVal* JVParse(const char* text, int len);
void JVFree(JVal* v);
int JVDump(JVal* v, char* out, int outLen, int indent);

// helper: append child
void JVAdd(JVal* parent, JVal* child);
