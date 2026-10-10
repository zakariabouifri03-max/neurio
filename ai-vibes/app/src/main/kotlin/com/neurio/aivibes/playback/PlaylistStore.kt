package com.neurio.aivibes.playback

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** A user playlist: ordered list of MediaStore track ids. */
data class Playlist(
    val id: String,
    val name: String,
    val trackIds: List<Long>
)

/**
 * Tiny JSON file store for playlists and per-device preset assignments.
 * Deliberately not Room: the data volume is minuscule and this keeps the APK
 * and the build light for budget devices.
 */
class PlaylistStore(private val context: Context) {

    private val file get() = context.filesDir.resolve("playlists.json")

    fun load(): List<Playlist> {
        return try {
            if (!file.exists()) return emptyList()
            val root = JSONArray(file.readText())
            val out = ArrayList<Playlist>()
            for (i in 0 until root.length()) {
                val o = root.getJSONObject(i)
                val ids = o.optJSONArray("trackIds") ?: JSONArray()
                val list = ArrayList<Long>()
                for (j in 0 until ids.length()) list.add(ids.getLong(j))
                out.add(Playlist(o.getString("id"), o.getString("name"), list))
            }
            out
        } catch (t: Throwable) {
            emptyList()
        }
    }

    fun save(playlists: List<Playlist>) {
        try {
            val root = JSONArray()
            playlists.forEach { p ->
                val o = JSONObject()
                o.put("id", p.id)
                o.put("name", p.name)
                val ids = JSONArray()
                p.trackIds.forEach { ids.put(it) }
                o.put("trackIds", ids)
                root.put(o)
            }
            file.writeText(root.toString())
        } catch (t: Throwable) {
            // Best-effort persistence; never crash the UI for this.
        }
    }

    fun create(name: String, trackIds: List<Long> = emptyList()): Playlist {
        val all = load().toMutableList()
        val p = Playlist(UUID.randomUUID().toString(), name, trackIds)
        all.add(p)
        save(all)
        return p
    }

    fun delete(id: String) {
        save(load().filterNot { it.id == id })
    }

    fun rename(id: String, name: String) {
        save(load().map { if (it.id == id) it.copy(name = name) else it })
    }

    fun addTracks(id: String, trackIds: List<Long>) {
        save(
            load().map {
                if (it.id == id) it.copy(trackIds = (it.trackIds + trackIds).distinct())
                else it
            }
        )
    }

    fun removeTrack(id: String, trackId: Long) {
        save(load().map { if (it.id == id) it.copy(trackIds = it.trackIds - trackId) else it })
    }
}
