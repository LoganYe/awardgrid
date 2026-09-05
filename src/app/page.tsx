import { redirect } from "next/navigation";

/** The app has one real page: the grid. */
export default function Home(): never {
  redirect("/grid");
}
