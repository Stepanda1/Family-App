import { create } from "zustand";

type FamilyStore = {
  familyId: string;
  setFamilyId: (familyId: string) => void;
};

export const useFamilyStore = create<FamilyStore>((set) => ({
  familyId: "0a6fcac1-6711-494d-8387-c75045ac375e",
  setFamilyId: (familyId) => set({ familyId })
}));
