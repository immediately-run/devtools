// The edited repo's working tree, resolved once per frame (both halves need it): the
// `type: 'worktree'` mount the host materializes for the binding's
// `exposesWorkingTree: 'ro'`, which arrives after boot. `undefined` while resolving,
// `null` when there is none (standalone, or a host exposing no tree).
import { useEffect, useState } from 'react';
import type { SandboxMount } from '@immediately-run/sdk';
import { hostPorts, resolveWorkingTree } from '../lib/host';
import type { RunPorts } from '../lib/run';

export interface WorkingTree {
  mount: SandboxMount;
  ports: RunPorts;
}

export function useWorkingTree(): WorkingTree | null | undefined {
  const [tree, setTree] = useState<WorkingTree | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void resolveWorkingTree().then((mount) => {
      if (!cancelled) setTree(mount ? { mount, ports: hostPorts(mount) } : null);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return tree;
}
