import type { Metadata } from "next";
import { WhereAmIClient } from "./WhereAmIClient";

export const metadata: Metadata = {
  title: "Where am I",
  description: "작업 중인 파일, API, 서비스 영향 범위를 한 화면에서 보는 그래프",
};

export default function Home() {
  return <WhereAmIClient />;
}
