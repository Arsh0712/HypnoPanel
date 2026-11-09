import type { MetadataRoute } from "next";
import { DOC_PAGES } from "@/content/site/docs";

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://hypnotype.mangocloud.cyou";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE}/install`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${SITE}/docs`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${SITE}/changelog`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${SITE}/security`, changeFrequency: "monthly", priority: 0.6 },
  ];
  const docPages: MetadataRoute.Sitemap = DOC_PAGES.map((p) => ({
    url: `${SITE}/docs/${p.slug}`,
    lastModified: new Date(p.updated),
    changeFrequency: "monthly",
    priority: 0.7,
  }));
  return [...staticPages, ...docPages].map((e) => ({ ...e, lastModified: e.lastModified ?? now }));
}
