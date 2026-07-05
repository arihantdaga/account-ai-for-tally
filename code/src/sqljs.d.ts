// sql.js ships no type declarations. A minimal module declaration keeps the
// import statically analyzable (so Bun bundles it into the single binary) while
// typing the surface we use as `any` locally in database.mts.
declare module 'sql.js' {
  // biome-ignore lint/suspicious/noExplicitAny: sql.js is untyped upstream.
  const initSqlJs: (config?: any) => Promise<any>;
  export default initSqlJs;
}
