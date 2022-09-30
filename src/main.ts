import { createApp } from 'vue'
import { createPinia } from 'pinia'
import {Quasar} from 'quasar'


import App from './App.vue'
import router from './router'

// Import icon libraries
import '@quasar/extras/material-icons/material-icons.css'
import '@quasar/extras/fontawesome-v6/fontawesome-v6.css'
// A few examples for animations from Animate.css:
import "@quasar/extras/animate/fadeIn.css"
import "@quasar/extras/animate/fadeOut.css"
// Import Quasar css
import 'quasar/src/css/index.sass'
import './assets/main.scss'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(Quasar, {
    plugins: {}, // import Quasar plugins and add here
    config: {notify: { /* look at QuasarConfOptions from the API card */}
    },
})

app.mount('#app')
