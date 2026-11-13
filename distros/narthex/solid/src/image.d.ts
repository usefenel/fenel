// TypeScript allows one wildcard per declaration. These suffixes cover the
// current imagetools imports; add a declaration when introducing a new query.
declare module "*&as=srcset" {
  const srcset: string;
  export default srcset;
}

declare module "*&format=webp" {
  const src: string;
  export default src;
}

declare module "*&format=webp&inline" {
  const src: string;
  export default src;
}

declare module "*?w=1200" {
  const src: string;
  export default src;
}
