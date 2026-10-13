/*
 * gdcheck — standalone GDScript syntax validator for BlockStrike Royale.
 *
 * Uses the tree-sitter runtime (MIT, (c) Max Brunsfeld) and the
 * tree-sitter-gdscript grammar (MIT, (c) Preston Knopp) to parse every
 * .gd file and report ERROR / MISSING nodes with line:column positions.
 *
 * Build: see tools/gdcheck/build.sh
 * Usage: ./gdcheck FILE [FILE...]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "tree_sitter/api.h"

const TSLanguage *tree_sitter_gdscript(void);

static char *read_file(const char *path, size_t *out_len) {
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (n < 0) { fclose(f); return NULL; }
    char *buf = (char *)malloc((size_t)n + 1);
    if (!buf) { fclose(f); return NULL; }
    size_t got = fread(buf, 1, (size_t)n, f);
    buf[got] = '\0';
    *out_len = got;
    fclose(f);
    return buf;
}

static int problems = 0;
static int json_mode = 0;

static void json_escape(const char *src, uint32_t a, uint32_t b, int limit) {
    uint32_t n = b - a;
    if ((int)n > limit) n = (uint32_t)limit;
    putchar('"');
    for (uint32_t i = 0; i < n; i++) {
        unsigned char c = (unsigned char)src[a + i];
        switch (c) {
            case '"': fputs("\\\"", stdout); break;
            case '\\': fputs("\\\\", stdout); break;
            case '\n': fputs("\\n", stdout); break;
            case '\r': fputs("\\r", stdout); break;
            case '\t': fputs("\\t", stdout); break;
            default:
                if (c < 0x20) printf("\\u%04x", c);
                else putchar(c);
        }
    }
    putchar('"');
}

/* Dumps a compact JSON AST: node type, byte range, row/col, and the source
   text of leaf nodes (bounded), which is what the Python semantic analyzer
   needs without re-implementing a GDScript parser. */
static void dump_json(TSNode node, const char *src) {
    TSPoint start = ts_node_start_point(node);
    TSPoint end = ts_node_end_point(node);
    printf("{\"t\":");
    json_escape(ts_node_type(node), 0, (uint32_t)strlen(ts_node_type(node)), 64);
    printf(",\"a\":%u,\"b\":%u,\"r\":%u,\"c\":%u,\"er\":%u,\"ec\":%u",
           ts_node_start_byte(node), ts_node_end_byte(node),
           start.row + 1, start.column + 1, end.row + 1, end.column + 1);
    uint32_t count = ts_node_child_count(node);
    if (count == 0) {
        printf(",\"s\":");
        json_escape(src, ts_node_start_byte(node), ts_node_end_byte(node), 200);
    } else {
        printf(",\"ch\":[");
        for (uint32_t i = 0; i < count; i++) {
            if (i) putchar(',');
            dump_json(ts_node_child(node, i), src);
        }
        putchar(']');
    }
    putchar('}');
}

static void walk(TSNode node, const char *src) {
    const char *type = ts_node_type(node);
    if (strcmp(type, "ERROR") == 0 || ts_node_is_missing(node)) {
        TSPoint start = ts_node_start_point(node);
        TSPoint end = ts_node_end_point(node);
        uint32_t a = ts_node_start_byte(node), b = ts_node_end_byte(node);
        int len = (int)(b - a);
        if (len > 70) len = 70;
        fprintf(stderr, "  %s at %u:%u (to %u:%u): \"%.*s\"\n",
                ts_node_is_missing(node) ? "MISSING" : "ERROR",
                start.row + 1, start.column + 1, end.row + 1, end.column + 1,
                len, src + a);
        problems++;
    }
    uint32_t count = ts_node_child_count(node);
    for (uint32_t i = 0; i < count; i++) walk(ts_node_child(node, i), src);
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: gdcheck [--json] FILE [FILE...]\n"); return 2; }
    int first = 1;
    if (strcmp(argv[1], "--json") == 0) { json_mode = 1; first = 2; }
    TSParser *parser = ts_parser_new();
    ts_parser_set_language(parser, tree_sitter_gdscript());
    int bad_files = 0;
    if (json_mode && first >= argc) { fprintf(stderr, "no input files\n"); return 2; }
    for (int i = first; i < argc; i++) {
        size_t len = 0;
        char *src = read_file(argv[i], &len);
        if (!src) { fprintf(stderr, "cannot read %s\n", argv[i]); bad_files++; continue; }
        TSTree *tree = ts_parser_parse_string(parser, NULL, src, (uint32_t)len);
        TSNode root = ts_tree_root_node(tree);
        if (json_mode) {
            dump_json(root, src);
            putchar('\n');
            ts_tree_delete(tree);
            free(src);
            continue;
        }
        int before = problems;
        if (ts_node_has_error(root)) {
            fprintf(stderr, "%s: SYNTAX ERROR\n", argv[i]);
            walk(root, src);
        }
        if (ts_node_child_count(root) == 0 && ts_node_end_byte(root) < (uint32_t)len) {
            fprintf(stderr, "%s: parser consumed only %u of %zu bytes\n", argv[i],
                    ts_node_end_byte(root), len);
            problems++;
        }
        if (problems != before) bad_files++;
        ts_tree_delete(tree);
        free(src);
    }
    ts_parser_delete(parser);
    if (bad_files) {
        fprintf(stderr, "gdcheck: %d file(s) with syntax problems\n", bad_files);
        return 1;
    }
    if (json_mode) fprintf(stderr, "gdcheck: %d file(s) parsed clean\n", argc - first);
    else printf("gdcheck: %d file(s) parsed clean\n", argc - first);
    return 0;
}
