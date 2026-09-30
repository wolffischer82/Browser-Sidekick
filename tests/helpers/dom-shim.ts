/**
 * Two happy-dom gaps that break DOMPurify in component and unit tests
 * (decisions.md T10). Test-only; the e2e checks the sanitiser in real
 * Chromium as well.
 *
 * 1. happy-dom defines `nodeName` on each node subclass and leaves a getter
 *    on `Node.prototype` that returns ''. Browsers define it once, on
 *    `Node.prototype`, which DOMPurify reads, so every element looked
 *    nameless. The getter below dispatches to the subclass's own one.
 * 2. happy-dom's NodeIterator ignores the DOM standard's "pre-removing
 *    steps", so after DOMPurify removes the current node, iteration jumps
 *    into the removed subtree or stops. The iterator below follows the
 *    standard for the case DOMPurify uses: the reference node removed after
 *    `nextNode()` returned it continues from the node that preceded it.
 */

function preceding(node: Node, root: Node): Node | null {
  if (node === root) return null;
  let prev = node.previousSibling;
  if (!prev) return node.parentNode;
  while (prev.lastChild) prev = prev.lastChild;
  return prev;
}

function following(node: Node, root: Node): Node | null {
  if (node.firstChild) return node.firstChild;
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.nextSibling) return current.nextSibling;
    current = current.parentNode;
  }
  return null;
}

function shows(node: Node, whatToShow: number): boolean {
  return (whatToShow & (1 << (node.nodeType - 1))) !== 0;
}

if (typeof Node !== 'undefined') {
  const base = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeName');
  Object.defineProperty(Node.prototype, 'nodeName', {
    configurable: true,
    get(this: Node): string {
      let proto = Object.getPrototypeOf(this) as object | null;
      while (proto && proto !== Node.prototype) {
        const own = Object.getOwnPropertyDescriptor(proto, 'nodeName');
        if (own?.get) return own.get.call(this) as string;
        proto = Object.getPrototypeOf(proto) as object | null;
      }
      return (base?.get?.call(this) as string | undefined) ?? '';
    },
  });

  // The prototype that really holds the method: happy-dom's global
  // `Document` isn't the class of `document`.
  let owner = Object.getPrototypeOf(document) as object | null;
  while (owner && !Object.getOwnPropertyNames(owner).includes('createNodeIterator')) {
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  (owner as Document).createNodeIterator = function createNodeIterator(
    root: Node,
    whatToShow = 0xffffffff,
    filter: NodeFilter | null = null,
  ): NodeIterator {
    let reference: Node | null = null;
    let before: Node | null = null;
    const accept = (node: Node) => {
      if (!shows(node, whatToShow)) return false;
      if (!filter) return true;
      const result = typeof filter === 'function' ? filter(node) : filter.acceptNode(node);
      return result === NodeFilter.FILTER_ACCEPT;
    };
    const iterator = {
      root,
      whatToShow,
      filter,
      get referenceNode() {
        return reference ?? root;
      },
      pointerBeforeReferenceNode: false,
      nextNode(): Node | null {
        let node: Node | null;
        if (reference === null) node = root;
        else if (root.contains(reference)) node = following(reference, root);
        else node = before && root.contains(before) ? following(before, root) : null;
        while (node && !accept(node)) node = following(node, root);
        if (node) {
          reference = node;
          before = preceding(node, root);
        }
        return node;
      },
      previousNode: () => null,
      detach: () => undefined,
    };
    return iterator;
  };
}
