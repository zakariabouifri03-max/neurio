package com.neurio.vm.vm;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The backend registry and the auto-selection rule.
 *
 * <p>Preference order is by how much of a real second system the backend gives
 * you, not by how likely it is to work:
 * <pre>
 *   redroid   → complete Android userspace on the host kernel   (needs root + binder)
 *   qemu      → complete guest, its own kernel                  (needs root + binary + image)
 *   avf       → genuine protected VM                            (needs a privileged permission)
 *   sandbox   → isolated runtime with a rewritten web identity  (needs nothing)
 * </pre>
 * The last one is always available, so {@link #preferred(Capability, VmSettings)}
 * never returns null. That is deliberate: the console must always have something
 * it can start, and must say out loud which tier it fell back to.
 */
public final class Backends {

    private Backends() {}

    /** Every backend, best-first. */
    public static List<VmBackend> all(VmSettings settings) {
        List<VmBackend> out = new ArrayList<>(4);
        out.add(new RedroidBackend(settings));
        out.add(new QemuBackend(settings));
        out.add(new AvfBackend(settings));
        out.add(new SandboxBackend());
        return Collections.unmodifiableList(out);
    }

    public static VmBackend byId(String id, VmSettings settings) {
        for (VmBackend b : all(settings)) {
            if (b.id().equals(id)) return b;
        }
        return new SandboxBackend();
    }

    /** The user's explicit choice if it can run, otherwise the best one that can. */
    public static VmBackend preferred(Capability c, VmSettings settings) {
        String chosen = settings.preferredBackend();
        if (chosen != null && !chosen.isEmpty()) {
            VmBackend b = byId(chosen, settings);
            if (b.isAvailable(c)) return b;
        }
        for (VmBackend b : all(settings)) {
            if (b.isAvailable(c)) return b;
        }
        return new SandboxBackend();
    }

    /** One line per backend, for the console list. */
    public static List<String> describeAll(Capability c, VmSettings settings) {
        List<String> out = new ArrayList<>();
        for (VmBackend b : all(settings)) {
            out.add((b.isAvailable(c) ? "[ready] " : "[  --  ] ") + b.id()
                    + " — " + b.name() + " (" + b.requirement() + ")");
            out.add("         " + b.verdict(c));
        }
        return out;
    }

    /** The tier the auto-selection landed on, in words. */
    public static String tier(VmBackend b) {
        switch (b.id()) {
            case RedroidBackend.ID: return "Tier 1 — full Android userspace in a container";
            case QemuBackend.ID:    return "Tier 2 — full guest Android on its own kernel";
            case AvfBackend.ID:     return "Tier 3 — platform hypervisor, config generated";
            case SandboxBackend.ID: return "Tier 4 — isolated in-app runtime with a rewritten web identity";
            default:                return "Unknown backend";
        }
    }
}
