export const getById = (id) => document.getElementById(id);

const applyProps = (node, props) => {
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style') Object.assign(node.style, v);
    else if (k === 'data') Object.assign(node.dataset, v);
    else if (k === 'on') for (const [type, fn] of Object.entries(v)) node.addEventListener(type, fn);
    else node[k] = v;
  }
};

export function el(tag, props, children) {
  const node = document.createElement(tag);
  if (typeof props === 'string') node.className = props;
  else if (props) applyProps(node, props);
  return append(node, children);
}

export function mk(tag, cls, parent, text) {
  const node = el(tag, cls, text);
  if (parent) parent.appendChild(node);
  return node;
}

export function append(parent, children) {
  if (children == null) return parent;
  if (typeof children === 'string' || typeof children === 'number') parent.textContent = String(children);
  else for (const c of Array.isArray(children) ? children : [children]) if (c) parent.appendChild(c);
  return parent;
}
