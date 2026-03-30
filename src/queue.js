import { nanoid } from 'nanoid';

/**
 * In-memory approval queue.
 * Each pending request holds a reference to the HTTP response Promise,
 * so when the user responds via Telegram, we resolve it immediately.
 */
export class ApprovalQueue {
  constructor({ timeoutSeconds = 300, fallbackAction = 'ask' } = {}) {
    this.pending = new Map();
    this.timeoutSeconds = timeoutSeconds;
    this.fallbackAction = fallbackAction;
    this.approveAllUntil = null; // timestamp for /approveall mode
    this.paused = false;
  }

  /**
   * Check if we're in "approve all" mode
   */
  isAutoApproving() {
    if (!this.approveAllUntil) return false;
    if (Date.now() < this.approveAllUntil) return true;
    this.approveAllUntil = null;
    return false;
  }

  /**
   * Enable auto-approve for N minutes
   */
  setApproveAll(minutes) {
    this.approveAllUntil = Date.now() + minutes * 60 * 1000;
  }

  /**
   * Disable auto-approve
   */
  clearApproveAll() {
    this.approveAllUntil = null;
  }

  /**
   * Add a new approval request. Returns a Promise that resolves
   * when the user responds or timeout is reached.
   */
  add({ toolName, toolInput, sessionId, cwd }) {
    const id = nanoid(10);
    const createdAt = Date.now();

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({
          decision: this.fallbackAction,
          reason: `Timeout after ${this.timeoutSeconds}s — falling back to "${this.fallbackAction}"`,
          timedOut: true,
        });
      }, this.timeoutSeconds * 1000);

      this.pending.set(id, {
        id,
        toolName,
        toolInput,
        sessionId,
        cwd,
        createdAt,
        timer,
        resolve,
      });
    });
  }

  /**
   * Resolve a pending request with user's decision
   */
  respond(id, decision, reason = '') {
    const entry = this.pending.get(id);
    if (!entry) return false;

    clearTimeout(entry.timer);
    this.pending.delete(id);

    entry.resolve({
      decision,
      reason: reason || (decision === 'allow' ? 'Approved remotely' : 'Denied remotely'),
      timedOut: false,
    });

    return true;
  }

  /**
   * Get a specific pending request (without resolving)
   */
  get(id) {
    const entry = this.pending.get(id);
    if (!entry) return null;
    return {
      id: entry.id,
      toolName: entry.toolName,
      toolInput: entry.toolInput,
      sessionId: entry.sessionId,
      cwd: entry.cwd,
      createdAt: entry.createdAt,
    };
  }

  /**
   * List all pending requests
   */
  list() {
    return Array.from(this.pending.values()).map((e) => ({
      id: e.id,
      toolName: e.toolName,
      sessionId: e.sessionId,
      cwd: e.cwd,
      createdAt: e.createdAt,
      age: Math.round((Date.now() - e.createdAt) / 1000),
    }));
  }

  /**
   * Approve all currently pending requests
   */
  approveAllPending() {
    let count = 0;
    for (const [id] of this.pending) {
      this.respond(id, 'allow', 'Bulk approved remotely');
      count++;
    }
    return count;
  }

  /**
   * Deny all currently pending requests
   */
  denyAllPending() {
    let count = 0;
    for (const [id] of this.pending) {
      this.respond(id, 'deny', 'Bulk denied remotely');
      count++;
    }
    return count;
  }

  get size() {
    return this.pending.size;
  }
}
