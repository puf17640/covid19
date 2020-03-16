const mongoose = require('mongoose')

mongoose.model('User', new mongoose.Schema({
  email: String,
  country: String,
  subscriptionDate: Date
}))