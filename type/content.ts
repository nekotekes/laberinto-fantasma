// types/content.ts
export type Category = {
  id: string;
  name: string;
  color?: string;
};

export type Word = {
  id: string;
  text: string;
  categoryId: string;
};

export type WordSet = {
  id: string;
  name: string;
  categories: Category[];
  words: Word[];
  createdAt: string;
  updatedAt: string;
};

export type AppData = {
  sets: WordSet[];
  activeSetId?: string;
};
