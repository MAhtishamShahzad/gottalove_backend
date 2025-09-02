import { StrapiApp } from "@strapi/strapi/admin";
import gotta from "../../gotta.png";

export default {
  config: {
    auth: {
      logo: gotta,
    },
    menu: {
      logo: gotta,
    },
    translations: {
      en: {
        "app.components.LeftMenu.navbrand.workplace": "Gottalove",
        "app.components.LeftMenu.navbrand.title": "Gottalove Admin",
        "app.components.HomePage.welcome.again": "Welcome to Gottalove 👋",
        "Auth.form.welcome.title": "Welcome to Gottalove!",
        "welcome-to-strapi!": "Welcome to Gottalove!",
        "Auth.form.welcome.subtitle": "Log in to your  Gottalove Dashboard",
        "Welcome to Strapi!": "Welcome to Gottalove!",
        "Log-in-to-your-Strapi-account": "Log in to your Gottalove account",
        "Auth.form.email.label": "Your Email Address",
        "Auth.form.password.label": "Your Secret Password",
        "Auth.form.button.login": "Sign In Now",
      },
    },
    locales: ["en"],
  },
  bootstrap(app: StrapiApp) {
    console.log(app);
  },
};
