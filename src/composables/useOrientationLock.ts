import { ScreenOrientation } from "@capacitor/screen-orientation";
import { useDevice } from "@/composables/useDevice";
import { isCapacitorAndroid } from "@/utils/env";

export const useOrientationLock = () => {
  const { isPad } = useDevice();

  const isPhoneAndroid = () => isCapacitorAndroid && !isPad.value;

  const lockPortrait = async () => {
    if (!isPhoneAndroid()) return;
    try {
      await ScreenOrientation.lock({ orientation: "portrait" });
    } catch (e) {
      console.warn("[useOrientationLock] lockPortrait 失败:", e);
    }
  };

  const lockLandscape = async () => {
    if (!isPhoneAndroid()) return;
    try {
      await ScreenOrientation.lock({ orientation: "landscape" });
    } catch (e) {
      console.warn("[useOrientationLock] lockLandscape 失败:", e);
    }
  };

  return {
    lockPortrait,
    lockLandscape,
    isPhoneAndroid,
  };
};
