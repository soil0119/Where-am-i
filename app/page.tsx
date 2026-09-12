import type { Metadata } from "next";
import { WhereAmIClient } from "./WhereAmIClient";

export const metadata: Metadata = {
  title: "Where am I",
  description: "Visualize how code changes affect files, APIs, services, databases, and tests across repositories.",
};

export default function Home() {
  return <WhereAmIClient />;
}
