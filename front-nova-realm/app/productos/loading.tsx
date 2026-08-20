import { CardSkeletons } from "@/components/loading";

export default function Loading() {
  return <div className="shell section"><CardSkeletons count={8} /></div>;
}
