import { ChangeSummary } from "./types";

interface ToJSON {
  toJSON(): any;
}

const metaSym = Symbol();

type ResultMeta = {
  url: string;
  profileUrl: string;
  links: Record<string, string>;
};

export class Result<T extends Record<string, any>> implements ToJSON {
  private [metaSym]: ResultMeta;
  constructor(data: T, meta: ResultMeta) {
    Object.assign(this, data);
    this[metaSym] = meta;
  }

  toJSON() {
    const { [metaSym]: meta, ...others } = this;
    return {
      _links: {
        self: { href: meta.url },
        collection: { href: meta.profileUrl },
        ...Object.fromEntries(
          Object.entries(meta.links).map(([key, href]) => [key, { href }])
        ),
      },
      ...others,
    };
  }
}

type CollectionMeta = {
  page?: number;
  limit: number;
  hasMore: boolean;
  links: Record<string, string>;
  url: string;
  profileUrl: string;
};

export class CollectionResult<T extends Record<string, any>>
  extends Array<T>
  implements ToJSON {
  page?: number;
  limit: number;
  hasMore: boolean;
  links: Record<string, string>;
  url: string;
  profileUrl: string;

  constructor(items: T[], meta: CollectionMeta) {
    super(...items);
    this.page = meta.page;
    this.limit = meta.limit;
    this.hasMore = meta.hasMore;
    this.links = meta.links;
    this.url = meta.url;
    this.profileUrl = meta.profileUrl;
    Object.assign(this, meta);
  }

  get meta() {
    return {
      page: this.page,
      limit: this.limit,
      hasMore: this.hasMore,
      _links: {
        self: { href: this.url },
        profile: { href: this.profileUrl },
        ...Object.fromEntries(
          Object.entries(this.links).map(([key, href]) => [key, { href }])
        ),
      } as Record<string, { href: string }>,
    };
  }

  get items() {
    return [...this];
  }

  toJSON(this: CollectionResult<T>) {
    return {
      ...this.meta,
      items: this.items,
    };
  }
}

export class ChangeResult<T> implements ToJSON {
  data: T;
  changes: ChangeSummary<T>[];

  constructor(data: T, changes: ChangeSummary<T>[]) {
    this.data = data;
    this.changes = changes;
  }

  toJSON(this: ChangeResult<T>) {
    return {
      data: this.data,
      changes: this.changes,
    };
  }
}
