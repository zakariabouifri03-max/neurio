"""One timeline shared by picture and sound.

Sentences (from timing.json) are partitioned across shots. Chapter cards are
SILENT: they are inserted between shots and push everything after them later in
time — the voice is never cut, the audio track simply gets silence there.
"""
import json
import os

import shots as S
import kit

# (kind, first sentence, last sentence, kwargs) or ("card", title, sub, duration)
STORY = [
    ("card", "The Toaster", "ROCHESTER, NEW YORK — 1975", 1.7),
    (S.LabShot, 1, 2, {"people": [("sasson", 560, 1060, 1.55, "stand", "neutral")],
                       "labels": [("DECEMBER 1975", (1310, 220), "December", {"size": 82})]}),
    (S.CloseShot, 3, 4, {"people": [("sasson", 640, 1355, 2.55, "stand", "neutral")],
                         "tag": ("STEVE SASSON, 24", 120, 800, "Sasson"),
                         "tag_sub": "ELECTRICAL ENGINEER, EASTMAN KODAK"}),
    (S.GraphicShot, 5, 5, {"items": [("icon", "sensor", (430, 560), 1.05, "sensor"),
                                    ("icon", "cassette", (960, 560), 0.95, "cassette"),
                                    ("icon", "camera", (1500, 560), 0.95, "recorder")],
                           "labels": [("SENSOR · LENS · BOARDS · TAPE", (960, 270), "wired", {"size": 64})]}),
    (S.CloseShot, 6, 7, {"icons": [("camera", (1180, 300), 1.15)],
                         "labels": [("8 LBS", (1560, 300), "eight pounds", {"size": 92}),
                                    ("SIZE OF A TOASTER", (700, 210), "toaster", {"size": 74})]}),
    (S.CloseShot, 8, 8, {"people": [("sasson", 700, 1360, 2.45, "point", "smile")],
                         "icons": [("camera", (1560, 700), 0.85)],
                         "labels": [("A COLLEAGUE", (1300, 300), "colleague", {"size": 70})]}),
    (S.BlackShot, 9, 9, {"lines": [("Then he waited.", 96, "brush", (240, 232, 210))]}),
    (S.GraphicShot, 10, 11, {"items": [("counter", 23, (700, 540), 1.35, "Twenty-three", "")],
                             "labels": [("SECONDS", (700, 730), "seconds", {"size": 88}),
                                        ("ONE PICTURE ONTO TAPE", (1290, 320), "tape", {"size": 66})]}),
    (S.GraphicShot, 12, 15, {"items": [("pixels", (700, 540), 1.0, "hundred")],
                             "labels": [("100 × 100", (1420, 320), "hundred pixels wide", {"size": 88}),
                                        ("0.01 MP", (1420, 500), "megapixel", {"size": 76}),
                                        ("BLACK & WHITE", (1420, 660), "Black", {"size": 60}),
                                        ("MOSTLY STATIC", (1420, 800), "static", {"size": 60})]}),
    (S.SplitShot, 16, 17, {}),
    (S.BoardShot, 18, 19, {"people": [("kellner", 1420, 1060, 1.55, "fold", "frown"),
                                      ("board1", 470, 1090, 1.45, "stand", "neutral"),
                                      ("board2", 810, 1100, 1.45, "stand", "neutral")],
                           "camera_on_table": True,
                           "labels": [("THE PEOPLE WHO RAN KODAK", (1150, 400), "people", {"size": 72})]}),
    (S.CloseShot, 20, 21, {"people": [("kellner", 700, 1365, 2.55, "fold", "talk")],
                           "labels": [("NOBODY GASPED.", (1310, 320), "gasped", {"size": 84})],
                           "tag": ("WALTER KELLNER", 120, 720, "Kellner"),
                           "tag_sub": "DIRECTOR, ADVANCED TECHNOLOGY"}),
    (S.GraphicShot, 22, 22, {"labels": [("\u201cWHAT DO YOU THINK THIS IS GOING", (960, 430), "business", {"size": 82}),
                                       ("TO DO TO OUR FILM BUSINESS?\u201d", (960, 570), "business", {"size": 82})]}),
    (S.CloseShot, 23, 24, {"people": [("sasson", 700, 1355, 2.55, "stand", "shut")],
                           "labels": [("\u201cI DON'T KNOW — BUT I KNOW IT WORKS.\u201d", (1200, 300), "worked",
                                       {"size": 62, "fill": kit.CREAM})]}),
    ("card", "The Room", "THE LINE THAT MADE IT FAMOUS", 1.6),
    (S.BoardShot, 25, 26, {"people": [("kellner", 1400, 1060, 1.55, "fold", "shut"),
                                      ("board1", 470, 1090, 1.45, "stand", "neutral")],
                           "camera_on_table": True,
                           "stamp": [("CUTE.", (900, 470), "cute", kit.LIME, 128, -6)]}),
    (S.BoardShot, 27, 28, {"people": [("kellner", 1380, 1060, 1.55, "fold", "shut"),
                                      ("board2", 560, 1095, 1.45, "stand", "neutral")],
                           "camera_on_table": True, "ring": True,
                           "stamp": [("DON'T TELL ANYONE.", (1000, 480), "anyone", kit.RED, 90, -4)]}),
    (S.GraphicShot, 29, 30, {"items": [("chart", (0.26, 0.52, 0.74, 0.92), (700, 600), 1.05, "ninety")],
                             "labels": [("90% OF US FILM", (1390, 390), "ninety", {"size": 82}),
                                        ("EVERY ROLL: CAMERA · PROCESSING · PRINT · CHEMISTRY",
                                         (960, 250), "roll", {"size": 46})]}),
    (S.GraphicShot, 31, 31, {"items": [("tiles", ["camera", "canister", "print", "chemical"], 620, 1.0, "chemical", True)],
                             "labels": [("THE MACHINE ERASED ALL FOUR", (960, 950), "erased", {"size": 62})]}),
    ("card", "The Thirty-Seven Years", "WHAT REALLY HAPPENED", 1.7),
    (S.GraphicShot, 32, 33, {"labels": [("KODAK DID NOT IGNORE DIGITAL", (960, 360), "ignore", {"size": 92}),
                                        ("THAT PART IS A MYTH", (960, 540), "myth", {"size": 82, "fill": kit.RED})]}),
    (S.DocumentShot, 34, 34, {"paper": "patent", "stamp_patent": True, "label_patent": "PATENT US 4,131,919"}),
    (S.GraphicShot, 35, 36, {"items": [("chart", (0.2, 0.34, 0.58, 0.88), (700, 580), 1.0, "poured")],
                             "labels": [("MONEY INTO DIGITAL RESEARCH", (1400, 300), "money", {"size": 62}),
                                        ("#1 IN US DIGITAL CAMERAS", (1400, 640), "anyone", {"size": 58})]}),
    (S.CloseShot, 37, 37, {"people": [("kellner", 700, 1365, 2.55, "hold", "frown")],
                           "icons": [("canister", (1700, 250), 0.85)],
                           "labels": [("THE MARGIN", (1230, 320), "margin", {"size": 88})]}),
    (S.CloseShot, 38, 38, {"people": [("sasson", 660, 1365, 2.55, "stand", "neutral")],
                           "tag": ("BUILT BY THEIR OWN ENGINEER", 120, 800, "engineer"),
                           "tag_sub": "STEVE SASSON, EASTMAN KODAK"}),
    (S.DocumentShot, 39, 39, {"paper": "news"}),
    (S.BlackShot, 40, 40, {"lines": [("THE COMPANY THAT INVENTED", 80, "brush", (236, 228, 208)),
                                     ("THE DIGITAL PHOTOGRAPH", 80, "brush", (236, 228, 208)),
                                     ("COULD NOT SURVIVE IT.", 80, "brush", (200, 76, 62))]}),
    (S.MedalShot, 41, 42, {"people": [("sasson", 720, 1100, 2.1, "stand", "smile")],
                           "labels": [("NATIONAL MEDAL OF TECHNOLOGY", (720, 250), "Medal", {"size": 56}),
                                      ("2009", (720, 360), "two", {"size": 84})],
                           "stamp": [("FOR THE INVENTION THAT UNDID HIS EMPLOYER", (960, 900), "employer",
                                      kit.RED, 54, -3)]}),
    ("card", "What the Line Means", "", 1.6),
    (S.BlackShot, 43, 44, {"lines": [("Cute.", 132, "brush", (216, 238, 108)),
                                     ("Do not tell anyone.", 96, "brush", (236, 228, 208))]}),
    (S.GraphicShot, 45, 46, {"items": [("tiles", ["robot", "brick", "pc", "camera"], 660, 1.0, "objects")],
                             "labels": [("EVERY INDUSTRY HAS ONE", (960, 240), "industry", {"size": 80}),
                                        ("A TOY THAT IS REALLY A WARNING", (960, 950), "warning", {"size": 58})]}),
    (S.GraphicShot, 47, 48, {"items": [("arrow", (600, 620), 0.6, True, "money")],
                             "labels": [("THE GIVEAWAY IS NEVER THE QUALITY", (1240, 300), "quality", {"size": 54}),
                                        ("IT'S WHO OWNS THE MONEY", (1240, 560), "money", {"size": 76}),
                                        ("IT THREATENS", (1240, 700), "threatens", {"size": 64})]}),
    (S.BoardShot, 49, 50, {"people": [("kellner", 1420, 1060, 1.55, "fold", "frown"),
                                      ("board1", 470, 1090, 1.45, "stand", "neutral"),
                                      ("board2", 810, 1100, 1.45, "stand", "neutral")],
                           "camera_on_table": True,
                           "labels": [("NOT STUPID. JUST DOING THE ARITHMETIC.", (960, 280), "stupid", {"size": 60})]}),
    (S.GraphicShot, 51, 54, {"items": [("icon", "arrow", (560, 620), 0.52, "arithmetic")],
                             "labels": [("SOMEONE BUILT THE FUTURE", (1230, 400), "built", {"size": 58}),
                                        ("SOMEONE ELSE DID THE ARITHMETIC", (1230, 530), "arithmetic", {"size": 50}),
                                        ("THE ARITHMETIC WON.", (960, 880), "won", {"size": 92})]}),
    ("polaroid", "", "", 3.6),
]


def build_plan(P):
    t = json.load(open(os.path.join(P, "timing.json")))
    sents = {s["i"]: s for s in t["sentences"]}
    n = len(sents)
    used = set()
    items = []
    for item in STORY:
        if item[0] == "card":
            items.append({"type": "card", "title": item[1], "sub": item[2], "dur": item[3]})
        elif item[0] == "polaroid":
            items.append({"type": "polaroid", "dur": item[3]})
        else:
            kind, a, b, kw = item
            ids = [i for i in range(a, b + 1) if i not in used]
            if not ids:
                continue
            used |= set(ids)
            items.append({"type": "shot", "kind": kind, "ids": ids, "kw": kw})
    missing = [i for i in range(1, n + 1) if i not in used]
    if missing:
        raise SystemExit(f"sentences not covered: {missing}")

    # pass 1: cumulative shift from silent cards
    shift, shifts = 0.0, []
    for it in items:
        shifts.append(shift)
        if it["type"] == "card":
            shift += it["dur"]
    total_shift = shift

    # pass 2: raw spans in shifted time
    for it, sh in zip(items, shifts):
        if it["type"] == "shot":
            ss = [sents[i] for i in it["ids"]]
            it["sents"] = [dict(s, start=s["start"] + sh, end=s["end"] + sh) for s in ss]
            it["s0"] = it["sents"][0]["start"]
            it["s1"] = it["sents"][-1]["end"]
        else:
            it["s0"] = it["s1"] = None

    # pass 3: sequential placement, cards absorb the silence they sit in
    cursor = 0.0
    for i, it in enumerate(items):
        if it["type"] == "card":
            nxt = next((x for x in items[i + 1:] if x["type"] == "shot"), None)
            room = (nxt["s0"] - cursor) if nxt else it["dur"]
            if items[i - 1]["type"] == "polaroid" if i else False:
                room = it["dur"]
            it["s0"] = cursor
            it["s1"] = cursor + max(0.85, min(it["dur"], max(0.85, room)))
        elif it["type"] == "polaroid":
            it["s0"] = cursor
            it["s1"] = cursor + it["dur"]
        else:
            it["s0"] = max(cursor, it["s0"])
            it["s1"] = max(it["s0"] + 0.5, it["s1"])
        cursor = it["s1"]

    # pass 4: stretch every shot to meet the next one (no gaps, no overlaps)
    shots = []
    for i, it in enumerate(items):
        if it["type"] == "card":
            kind, kw, ss, ids = S.ChapterShot, {"title": it["title"], "sub": it["sub"]}, [], []
        elif it["type"] == "polaroid":
            kind, kw, ss, ids = S.PolaroidShot, {}, [], []
        else:
            kind, kw, ss, ids = it["kind"], dict(it["kw"]), it["sents"], it["ids"]
        shots.append({"kind": kind, "s0": it["s0"], "s1": it["s1"], "kw": kw, "sents": ss, "ids": ids})
    for i in range(len(shots) - 1):
        shots[i]["s1"] = shots[i + 1]["s0"]
    # last speech shot gets a small tail before the polaroid
    total = shots[-1]["s1"]
    cards = [{"at": s["s0"], "dur": s["s1"] - s["s0"], "title": s["kw"].get("title", "")}
             for s in shots if s["kind"] is S.ChapterShot]
    audio_end = t["speech_end"] + total_shift
    return shots, cards, total, audio_end


def describe(P):
    shots, cards, total, audio_end = build_plan(P)
    print(f"shots={len(shots)} cards={len(cards)} picture={total:.2f}s audio={audio_end:.2f}s")
    for i, s in enumerate(shots):
        warn = ""
        if s["s1"] - s["s0"] < 1.0:
            warn = "  <-- SHORT"
        elif s["s1"] - s["s0"] > 11:
            warn = "  <-- LONG"
        print(f"{i:02d} {s['kind'].__name__:13s} {s['s0']:7.2f}-{s['s1']:7.2f} "
              f"({s['s1']-s['s0']:5.2f}s) {s['ids']}{warn}")
    for c in cards:
        print(f"   card {c['title']!r} at {c['at']:.2f} for {c['dur']}s")


if __name__ == "__main__":
    import sys
    describe(sys.argv[1])
