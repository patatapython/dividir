/**
 * The E2E suite owns its own database and server so it never writes into the
 * dev database (`dividir`) nor reuses a manually started dev server.
 */
export const E2E_DATABASE_URL = 'postgresql://dividir:dividir@localhost:5433/dividir_e2e';
export const E2E_PORT = 3100;
