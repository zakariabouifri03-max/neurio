#include "json.h"
#include <stdlib.h>
#include <string.h>
#include <math.h>

static JVal* jval_new(JKind k, const char* key){
    JVal* v = (JVal*)calloc(1, sizeof(JVal));
    if (!v) return 0;
    v->kind = k;
    if (key) StrCpyN_(v->key, 64, key);
    return v;
}
JVal* JVNew(JKind k, const char* key){ return jval_new(k, key); }

static void jval_add(JVal* parent, JVal* child){
    if (!parent || !child) return;
    if (!parent->child){ parent->child = child; return; }
    JVal* c = parent->child;
    while (c->next) c = c->next;
    c->next = child;
}
void JVAdd(JVal* parent, JVal* child){ jval_add(parent, child); }

JVal* JVObjPutNum(JVal* o, const char* k, double v){ JVal* n = jval_new(J_NUM, k); n->num = v; jval_add(o, n); return n; }
JVal* JVObjPutInt(JVal* o, const char* k, int v){ JVal* n = jval_new(J_NUM, k); n->num = (double)v; jval_add(o, n); return n; }
JVal* JVObjPutBool(JVal* o, const char* k, int v){ JVal* n = jval_new(J_BOOL, k); n->b = v ? 1 : 0; jval_add(o, n); return n; }
JVal* JVObjPutStr(JVal* o, const char* k, const char* v){
    JVal* n = jval_new(J_STR, k);
    StrCpyN_(n->str, 256, v ? v : "");
    jval_add(o, n);
    return n;
}

JVal* JVFind(JVal* o, const char* k){
    if (!o || o->kind != J_OBJ) return 0;
    for (JVal* c = o->child; c; c = c->next)
        if (StrLen_(c->key) && !strcmp(c->key, k)) return c;
    return 0;
}
double JVNum(JVal* o, const char* k, double dflt){ JVal* c = JVFind(o, k); return (c && c->kind == J_NUM) ? c->num : dflt; }
int JVInt(JVal* o, const char* k, int dflt){ JVal* c = JVFind(o, k); return (c && c->kind == J_NUM) ? (int)c->num : dflt; }
const char* JVStr(JVal* o, const char* k, const char* dflt){
    JVal* c = JVFind(o, k);
    return (c && c->kind == J_STR) ? c->str : dflt;
}

void JVFree(JVal* v){
    while (v){
        JVal* nx = v->next;
        if (v->child){ JVal* c = v->child; v->child = 0; JVFree(c); }
        free(v);
        v = nx;
    }
}

// ---------------------------------------------------------------- parser
typedef struct { const char* p; const char* end; int err; } P;
static void skipws(P* s){ while (s->p < s->end && (*s->p==' '||*s->p=='\t'||*s->p=='\n'||*s->p=='\r')) s->p++; }
static int parseval(JVal** out, P* s);

static int parses(JVal** out, P* s){
    skipws(s);
    if (s->p >= s->end || *s->p != '"'){ s->err = 1; return 0; }
    s->p++;
    char buf[256]; int n = 0;
    while (s->p < s->end && *s->p != '"'){
        char c = *s->p++;
        if (c == '\\' && s->p < s->end){
            char e = *s->p++;
            switch (e){
            case 'n': c = '\n'; break;
            case 't': c = '\t'; break;
            case 'r': c = '\r'; break;
            case 'b': c = '\b'; break;
            case 'f': c = '\f'; break;
            case '"': c = '"'; break;
            case '\\': c = '\\'; break;
            case '/': c = '/'; break;
            case 'u':
                if (s->p + 4 <= s->end){
                    int cp = 0;
                    for (int i = 0; i < 4; i++){
                        char h = s->p[i];
                        cp <<= 4;
                        if (h >= '0' && h <= '9') cp |= h - '0';
                        else if (h >= 'a' && h <= 'f') cp |= h - 'a' + 10;
                        else if (h >= 'A' && h <= 'F') cp |= h - 'A' + 10;
                        else { s->err = 1; return 0; }
                    }
                    s->p += 4;
                    // encode as utf-8
                    if (cp < 0x80) buf[n++] = (char)cp;
                    else if (cp < 0x800){ buf[n++] = (char)(0xC0|(cp>>6)); buf[n++] = (char)(0x80|(cp&63)); }
                    else { buf[n++] = (char)(0xE0|(cp>>12)); buf[n++] = (char)(0x80|((cp>>6)&63)); buf[n++] = (char)(0x80|(cp&63)); }
                    continue;
                }
                s->err = 1; return 0;
            default: s->err = 1; return 0;
            }
        }
        if (n < 255) buf[n++] = c;
    }
    if (s->p >= s->end){ s->err = 1; return 0; }
    s->p++; // closing quote
    buf[n] = 0;
    *out = jval_new(J_STR, 0);
    if (!*out){ s->err = 1; return 0; }
    StrCpyN_((*out)->str, 256, buf);
    return 1;
}

static int parsenum(JVal** out, P* s){
    skipws(s);
    const char* st = s->p;
    if (s->p < s->end && (*s->p=='-'||*s->p=='+')) s->p++;
    int digits = 0;
    while (s->p < s->end && ((*s->p>='0'&&*s->p<='9')||*s->p=='.'||*s->p=='e'||*s->p=='E'||*s->p=='-'||*s->p=='+')){ s->p++; digits++; }
    if (!digits){ s->err = 1; return 0; }
    char buf[64];
    int n = (int)(s->p - st);
    if (n > 63) n = 63;
    memcpy(buf, st, n); buf[n] = 0;
    *out = jval_new(J_NUM, 0);
    if (!*out){ s->err = 1; return 0; }
    (*out)->num = atof(buf);
    return 1;
}

static int parseobj(JVal** out, P* s){
    skipws(s);
    if (s->p >= s->end || *s->p != '{'){ s->err = 1; return 0; }
    s->p++;
    JVal* o = jval_new(J_OBJ, 0);
    if (!o){ s->err = 1; return 0; }
    *out = o;
    skipws(s);
    if (s->p < s->end && *s->p == '}'){ s->p++; return 1; }
    for (;;){
        skipws(s);
        char key[64];
        if (s->p >= s->end || *s->p != '"'){ s->err = 1; return 0; }
        s->p++;
        int n = 0;
        while (s->p < s->end && *s->p != '"'){
            char c = *s->p++;
            if (c == '\\' && s->p < s->end) c = *s->p++;
            if (n < 63) key[n++] = c;
        }
        if (s->p >= s->end){ s->err = 1; return 0; }
        s->p++;
        key[n] = 0;
        skipws(s);
        if (s->p >= s->end || *s->p != ':'){ s->err = 1; return 0; }
        s->p++;
        JVal* v = 0;
        if (!parseval(&v, s)){ return 0; }
        v->key[0] = 0;
        StrCpyN_(v->key, 64, key);
        jval_add(o, v);
        skipws(s);
        if (s->p < s->end && *s->p == ','){ s->p++; continue; }
        if (s->p < s->end && *s->p == '}'){ s->p++; return 1; }
        s->err = 1; return 0;
    }
}

static int parsearr(JVal** out, P* s){
    skipws(s);
    if (s->p >= s->end || *s->p != '['){ s->err = 1; return 0; }
    s->p++;
    JVal* o = jval_new(J_ARR, 0);
    if (!o){ s->err = 1; return 0; }
    *out = o;
    skipws(s);
    if (s->p < s->end && *s->p == ']'){ s->p++; return 1; }
    for (;;){
        JVal* v = 0;
        if (!parseval(&v, s)) return 0;
        jval_add(o, v);
        skipws(s);
        if (s->p < s->end && *s->p == ','){ s->p++; continue; }
        if (s->p < s->end && *s->p == ']'){ s->p++; return 1; }
        s->err = 1; return 0;
    }
}

static int parseval(JVal** out, P* s){
    skipws(s);
    if (s->p >= s->end){ s->err = 1; return 0; }
    char c = *s->p;
    if (c == '{') return parseobj(out, s);
    if (c == '[') return parsearr(out, s);
    if (c == '"') return parses(out, s);
    if (s->p + 4 <= s->end && !memcmp(s->p, "true", 4)){ s->p += 4; *out = jval_new(J_BOOL, 0); if (*out) (*out)->b = 1; return *out ? 1 : (s->err=1,0); }
    if (s->p + 5 <= s->end && !memcmp(s->p, "false", 5)){ s->p += 5; *out = jval_new(J_BOOL, 0); if (*out) (*out)->b = 0; return *out ? 1 : (s->err=1,0); }
    if (s->p + 4 <= s->end && !memcmp(s->p, "null", 4)){ s->p += 4; *out = jval_new(J_NULL, 0); return *out ? 1 : (s->err=1,0); }
    return parsenum(out, s);
}

JVal* JVParse(const char* text, int len){
    if (!text) return 0;
    P s = { text, text + len, 0 };
    JVal* v = 0;
    if (!parseval(&v, &s)) return 0;
    return v;
}

// ---------------------------------------------------------------- writer
static void dump(JVal* v, char* o, int n, int pos, int* p, int indent){
    if (!v || *p >= n - 1) return;
    int i = *p;
    #define PUT(c) do { if (i < n-1) o[i++] = (c); } while(0)
    #define STR(str) do { const char* q = (str); while (*q && i < n-1) o[i++] = *q++; } while(0)
    #define NL do { if (indent) { PUT('\n'); for (int k = 0; k < pos && i < n-1; k++) PUT(' '); } } while(0)
    switch (v->kind){
    case J_NULL: STR("null"); break;
    case J_BOOL: STR(v->b ? "true" : "false"); break;
    case J_NUM: {
        char b[32];
        if (v->num == (double)(long long)v->num) snprintf(b, sizeof b, "%lld", (long long)v->num);
        else snprintf(b, sizeof b, "%.6g", v->num);
        STR(b);
        break;
    }
    case J_STR: {
        PUT('"');
        for (const char* c = v->str; *c; c++){
            switch (*c){
            case '"': STR("\\\""); break;
            case '\\': STR("\\\\"); break;
            case '\n': STR("\\n"); break;
            case '\t': STR("\\t"); break;
            case '\r': STR("\\r"); break;
            default: PUT(*c);
            }
        }
        PUT('"');
        break;
    }
    case J_OBJ:
        if (!v->child){ STR("{}"); break; }
        PUT('{'); NL;
        for (JVal* c = v->child; c; c = c->next){
            for (int k = 0; k < pos + indent && i < n-1; k++) PUT(' ');
            STR("\"");
            for (const char* kk = c->key; *kk; kk++) PUT(*kk);
            STR("\": ");
            dump(c, o, n, pos + indent, p, indent);
            if (c->next){ PUT(','); NL; }
            else NL;
        }
        for (int k = 0; k < pos && i < n-1; k++) PUT(' ');
        PUT('}');
        break;
    case J_ARR:
        if (!v->child){ STR("[]"); break; }
        PUT('['); NL;
        for (JVal* c = v->child; c; c = c->next){
            for (int k = 0; k < pos + indent && i < n-1; k++) PUT(' ');
            dump(c, o, n, pos + indent, p, indent);
            if (c->next){ PUT(','); NL; }
            else NL;
        }
        for (int k = 0; k < pos && i < n-1; k++) PUT(' ');
        PUT(']');
        break;
    }
    *p = i;
    if (*p < n) o[*p] = 0;
    #undef PUT
    #undef STR
    #undef NL
}
int JVDump(JVal* v, char* out, int outLen, int indent){
    if (!out || outLen <= 0) return 0;
    int p = 0;
    dump(v, out, outLen, 0, &p, indent ? 1 : 0);
    out[outLen-1] = 0;
    return p;
}
