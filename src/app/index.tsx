import { Redirect } from "expo-router";

import { Loading } from "@/components/loading";
import { useSession } from "@/lib/session";

export default function IndexScreen() {
  const { ready, session } = useSession();

  if (!ready) return <Loading />;
  return <Redirect href={session ? "/m" : "/connect"} />;
}
