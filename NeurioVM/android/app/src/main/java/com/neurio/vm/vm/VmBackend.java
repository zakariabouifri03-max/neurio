package com.neurio.vm.vm;

/**
 * A way of presenting a virtual handset to the world.
 *
 * <p>NeurioVM does not pretend there is one way to do this. Four backends
 * implement the same interface and the console picks whichever the device can
 * actually support, in this order of preference:
 *
 * <table>
 *   <tr><th>backend</th><th>what really happens</th><th>needs</th></tr>
 *   <tr><td>{@code redroid}</td><td>a second Android in a container</td><td>root</td></tr>
 *   <tr><td>{@code qemu}</td><td>a real VM via qemu-system</td><td>root + binary</td></tr>
 *   <tr><td>{@code avf}</td><td>pKVM protected VM</td><td>privileged permission</td></tr>
 *   <tr><td>{@code sandbox}</td><td>isolated runtime inside this app</td><td>nothing</td></tr>
 * </table>
 *
 * <p>{@link #verdict(Capability)} is the contract that keeps the UI honest: a
 * backend that cannot run must say exactly why, in a sentence a user can act on.
 */
public interface VmBackend {

    /** What has to be true on the device before this backend can start. */
    enum Requirement {
        /** Works on any stock phone. */
        NONE,
        /** Needs a rooted device. */
        ROOT,
        /** Needs a permission only system apps can hold. */
        PRIVILEGED,
        /** Needs a binary the user installs themselves (e.g. via Termux). */
        USER_BINARY
    }

    String id();

    /** Short name shown in the backend picker. */
    String name();

    /** One sentence: what the user gets. */
    String tagline();

    /** A paragraph: how it works and where its limits are. */
    String detail();

    Requirement requirement();

    /** Can this backend start right now? */
    boolean isAvailable(Capability c);

    /**
     * Human-readable verdict. When {@link #isAvailable(Capability)} is false this
     * must explain what is missing and what the user could do about it.
     */
    String verdict(Capability c);

    /** Brings the backend up. Implementations must not block longer than a second. */
    void start(VmSession session) throws Exception;

    /** Tears it down. Must be safe to call when nothing is running. */
    void stop(VmSession session);
}
