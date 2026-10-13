extends Node
## World generation + meshing benchmark for every map.
func run() -> bool:
	VoxelArt.build()
	var ok := true
	for map_id in ["arena_blocks", "training_ground", "clash_town", "cubic_isle"]:
		var t0 := Time.get_ticks_msec()
		var w := WorldGen.generate(map_id)
		var t1 := Time.get_ticks_msec()
		VoxelMesher.prepare()
		var verts := 0
		for cx in w.chunks_x():
			for cz in w.chunks_z():
				var res := VoxelMesher.build_chunk(w, cx, cz)
				for r in res:
					if r != null:
						verts += (r[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()
		var t2 := Time.get_ticks_msec()
		print("%s gen %d ms, mesh %d ms, quads %d, loot spots %d, pois %d" % [map_id, t1 - t0, t2 - t1, verts / 4, w.loot_spots.size(), w.pois.size()])
		if verts == 0:
			ok = false
		if map_id == "cubic_isle":
			WorldGen.minimap_image(w).save_png("/tmp/minimap_cubic_isle.png")
	await get_tree().process_frame
	return ok
