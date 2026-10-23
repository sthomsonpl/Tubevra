// Kept free of main-process imports for the sandboxed preload bundle.
export const PAGE_IPC = {
  bootstrap: 'tubevra:page:bootstrap',
  hooksReport: 'tubevra:hooks:report',
  runtimeError: 'tubevra:page:runtime-error',
  ready: 'tubevra:page:ready',
  state: 'tubevra:page:state',
  report: 'tubevra:page:report',
};
