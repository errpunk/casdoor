import * as React from "react";

interface CaptchaWidgetProps {
  captchaType: string;
  subType?: string;
  siteKey?: string;
  clientSecret?: string;
  clientId2?: string;
  clientSecret2?: string;
  /** popup widgets initialize while idle and start when their caller becomes active */
  active?: boolean;
  onChange: (token: string) => void;
  /** a vendor overlay was closed or errored without producing a token */
  onCancel?: () => void;
}

const aliyunPopupButtonId = "aliyun-captcha-button";
const aliyunCaptchaScriptSrc = "https://o.alicdn.com/captcha-frontend/aliyunCaptcha/AliyunCaptcha.js";
const aliyunCaptchaWarmupMs = 2000;

let aliyunCaptchaScriptPromise: Promise<void> | undefined;

function loadScript(src: string) {
  const tag = document.createElement("script");
  tag.async = false;
  tag.src = src;
  document.getElementsByTagName("body")[0].appendChild(tag);
}

/**
 * Loads Alibaba Cloud's collector as early as the caller can provide the
 * provider prefix. The vendor recommends leaving time between loading this
 * script and starting verification so it can collect useful environment and
 * device signals. CaptchaWidget also initializes the popup while it is idle;
 * the caller activates that prepared instance when verification is requested.
 */
export function preloadAliyunCaptcha(prefix?: string): Promise<void> {
  if (!prefix || prefix === "***") {
    return Promise.resolve();
  }

  (window as any).AliyunCaptchaConfig = {region: "cn", prefix};
  if (typeof (window as any).initAliyunCaptcha === "function") {
    return Promise.resolve();
  }
  if (aliyunCaptchaScriptPromise) {
    return aliyunCaptchaScriptPromise;
  }

  const loadPromise = new Promise<void>((resolve, reject) => {
    const tag = document.createElement("script");
    tag.async = true;
    tag.src = aliyunCaptchaScriptSrc;
    tag.onload = () => {
      if (typeof (window as any).initAliyunCaptcha === "function") {
        resolve();
      } else {
        reject(new Error("Aliyun Captcha loaded without initAliyunCaptcha"));
      }
    };
    tag.onerror = () => reject(new Error("Failed to load Aliyun Captcha"));
    document.getElementsByTagName("body")[0].appendChild(tag);
  });

  aliyunCaptchaScriptPromise = loadPromise.catch((error) => {
    aliyunCaptchaScriptPromise = undefined;
    throw error;
  });
  return aliyunCaptchaScriptPromise;
}

/**
 * Mounts the third-party captcha widget the application is configured with.
 * Ported from web/src/common/CaptchaWidget.js — the vendor scripts, the element
 * id ("captcha") and the token formats are unchanged, so the backend keeps
 * validating exactly what it validated before.
 */
export function CaptchaWidget({
  captchaType,
  subType,
  siteKey,
  clientSecret,
  clientId2,
  clientSecret2,
  active = true,
  onChange,
  onCancel,
}: CaptchaWidgetProps) {
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;
  const onCancelRef = React.useRef(onCancel);
  onCancelRef.current = onCancel;
  const activeRef = React.useRef(active);
  activeRef.current = active;
  const startPopupRef = React.useRef<(() => void) | undefined>(undefined);

  React.useEffect(() => {
    const emit = (token: string) => onChangeRef.current(token);
    let timer: number | undefined;
    let clickTimer: number | undefined;
    let popupStartTimer: number | undefined;
    let unmounted = false;
    let destroyCaptcha: (() => void) | undefined;

    switch (captchaType) {
    case "reCAPTCHA":
    case "reCAPTCHA v2": {
      timer = window.setInterval(() => {
        if (!(window as any).grecaptcha) {
          loadScript("https://recaptcha.net/recaptcha/api.js");
        }
        if ((window as any).grecaptcha?.render) {
          (window as any).grecaptcha.render("captcha", {sitekey: siteKey, callback: emit});
          window.clearInterval(timer);
        }
      }, 300);
      break;
    }
    case "reCAPTCHA v3": {
      timer = window.setInterval(() => {
        if (!(window as any).grecaptcha) {
          loadScript(`https://recaptcha.net/recaptcha/api.js?render=${siteKey}`);
        }
        if ((window as any).grecaptcha?.render) {
          const clientId = (window as any).grecaptcha.render("captcha", {
            "sitekey": siteKey,
            "badge": "inline",
            "size": "invisible",
            "callback": emit,
            "error-callback": function() {
              const element = document.getElementById("captcha");
              if (!element) {
                return;
              }
              const logoWidth = `${element.offsetWidth + 40}px`;
              const logo = document.getElementsByClassName("grecaptcha-logo")[0] as HTMLElement | undefined;
              const badge = document.getElementsByClassName("grecaptcha-badge")[0] as HTMLElement | undefined;
              if (logo?.firstChild) {
                (logo.firstChild as HTMLElement).style.width = logoWidth;
              }
              if (badge) {
                badge.style.width = logoWidth;
              }
            },
          });
          (window as any).grecaptcha.ready(function() {
            (window as any).grecaptcha.execute(clientId, {action: "submit"});
          });
          window.clearInterval(timer);
        }
      }, 300);
      break;
    }
    case "hCaptcha": {
      timer = window.setInterval(() => {
        if (!(window as any).hcaptcha) {
          loadScript("https://js.hcaptcha.com/1/api.js");
        }
        if ((window as any).hcaptcha?.render) {
          (window as any).hcaptcha.render("captcha", {sitekey: siteKey, callback: emit});
          window.clearInterval(timer);
        }
      }, 300);
      break;
    }
    case "Aliyun Captcha": {
      const isPopup = subType === "Popup";
      preloadAliyunCaptcha(clientSecret2)
        .then(() => {
          if (!unmounted && clientSecret2 && clientSecret2 !== "***") {
            const options: Record<string, any> = {
              SceneId: clientId2,
              mode: isPopup ? "popup" : "embed",
              element: "#captcha",
              slideStyle: {width: 320, height: 40},
              language: "cn",
            };

            if (isPopup) {
              const initializedAt = Date.now();
              let settled = false;
              let instanceReady = false;
              let verificationStarted = false;
              let captchaInstance: any;
              const settle = (done: () => void) => {
                if (!settled) {
                  settled = true;
                  done();
                }
              };
              const startPopup = () => {
                if (!activeRef.current || verificationStarted || !captchaInstance) {
                  return;
                }
                verificationStarted = true;
                const warmupRemaining = Math.max(0, initializedAt + aliyunCaptchaWarmupMs - Date.now());
                popupStartTimer = window.setTimeout(() => {
                  if (unmounted || !activeRef.current) {
                    verificationStarted = false;
                    return;
                  }
                  if (typeof captchaInstance.startTracelessVerification === "function") {
                    captchaInstance.startTracelessVerification();
                  } else {
                    // non-traceless scenes only open from a click on `button`
                    clickTimer = window.setTimeout(() => document.getElementById(aliyunPopupButtonId)?.click(), 0);
                  }
                }, warmupRemaining);
              };
              startPopupRef.current = startPopup;

              options.button = `#${aliyunPopupButtonId}`;
              options.success = (data: any) => settle(() => emit(data.toString()));
              // a failed attempt keeps the popup open, so let the user try again
              options.fail = () => undefined;
              // the popup is the whole UI here: once it is gone without a token,
              // the caller has to be released or its flow hangs forever
              options.onClose = () => settle(() => onCancelRef.current?.());
              options.onError = () => settle(() => onCancelRef.current?.());
              options.getInstance = (nextInstance: any) => {
                if (!nextInstance || instanceReady) {
                  return;
                }
                if (unmounted) {
                  nextInstance.destroyCaptcha?.();
                  return;
                }
                instanceReady = true;
                captchaInstance = nextInstance;
                destroyCaptcha = () => captchaInstance.destroyCaptcha?.();
                startPopup();
              };
            } else {
              options.captchaVerifyCallback = (data: any) => emit(data.toString());
              options.immediate = true;
            }

            (window as any).initAliyunCaptcha(options);
          }
        })
        .catch(() => {
          if (!unmounted) {
            onCancelRef.current?.();
          }
        });
      break;
    }
    case "GEETEST": {
      let getLock = false;
      timer = window.setInterval(() => {
        if (!(window as any).initGeetest4) {
          loadScript("https://static.geetest.com/v4/gt4.js");
        }
        if ((window as any).initGeetest4 && siteKey && !getLock) {
          (window as any).initGeetest4({captchaId: String(siteKey), product: "float"}, function(captchaObj: any) {
            if (!getLock) {
              captchaObj.appendTo("#captcha");
              getLock = true;
            }
            captchaObj.onSuccess(function() {
              const result = captchaObj.getValidate();
              emit(
                `lot_number=${result.lot_number}&captcha_output=${result.captcha_output}&pass_token=${result.pass_token}&gen_time=${result.gen_time}&captcha_id=${siteKey}`,
              );
            });
          });
          window.clearInterval(timer);
        }
      }, 500);
      break;
    }
    case "Cloudflare Turnstile": {
      timer = window.setInterval(() => {
        if (!(window as any).turnstile) {
          loadScript("https://challenges.cloudflare.com/turnstile/v0/api.js");
        }
        if ((window as any).turnstile?.render) {
          (window as any).turnstile.render("#captcha", {sitekey: siteKey, callback: emit});
          window.clearInterval(timer);
        }
      }, 300);
      break;
    }
    default:
      break;
    }

    return () => {
      unmounted = true;
      startPopupRef.current = undefined;
      if (timer !== undefined) {
        window.clearInterval(timer);
      }
      if (clickTimer !== undefined) {
        window.clearTimeout(clickTimer);
      }
      if (popupStartTimer !== undefined) {
        window.clearTimeout(popupStartTimer);
      }
      destroyCaptcha?.();
    };
  }, [captchaType, subType, siteKey, clientSecret, clientId2, clientSecret2]);

  React.useEffect(() => {
    if (active) {
      startPopupRef.current?.();
    }
  }, [active]);

  return (
    <React.Fragment>
      <div id="captcha" />
      {/* Alibaba Cloud requires the trigger to sit outside the render container */}
      {captchaType === "Aliyun Captcha" && subType === "Popup" ? (
        <button id={aliyunPopupButtonId} type="button" hidden />
      ) : null}
    </React.Fragment>
  );
}
