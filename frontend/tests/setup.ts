import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount rendered components between tests so DOM from one test never
// leaks into the next — without this, getByText can match a stale node
// from an earlier render.
afterEach(cleanup);
